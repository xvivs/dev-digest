/**
 * INFRASTRUCTURE — Drizzle implementation of `SkillStore`. The only file in
 * the module that imports `drizzle-orm` or `db/**`. Rows never leave this
 * file: `toSkill` maps them to the domain shape.
 *
 * Also owns `resolveEffectiveSkills` — a cross-cutting read used by
 * `reviews/run-executor.ts` through `container.skillsRepo` (never by a direct
 * module import; see `modules-no-cross-import` in `.dependency-cruiser.cjs`).
 */
import { createHash } from 'node:crypto';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { SkillNameTakenError, SkillVetStaleError, type NewSkill, type Skill, type SkillListItem } from './domain.js';
import type { SkillStore, SkillWritePatch } from './ports.js';

/** A Drizzle transaction handle — structurally a `Db` for queries. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type SkillRow = typeof t.skills.$inferSelect;

/** One effective skill resolved for a run (SPEC-02 D1 / AC-25/27). */
export interface EffectiveSkill {
  id: string;
  name: string;
  version: number;
  body: string;
  sha256: string;
}

const SKILLS_NAME_UQ = 'skills_workspace_name_uq';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint_name?: unknown }).constraint_name === constraint
  );
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidenceFiles: row.evidenceFiles ?? null,
    needsVetting: row.needsVetting,
    vettedBodyHash: row.vettedBodyHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SkillsRepository implements SkillStore {
  constructor(private readonly db: Db | Tx) {}

  /** One query (LEFT JOIN + GROUP BY), no N+1 — `agent_count` is every agent
   *  linking the skill, regardless of the link's own enabled state.
   *  `q` is a linear `ILIKE '%q%'` scan over name/description within ONE
   *  workspace (a handful of skills), so no trigram index; add `pg_trgm` +
   *  GIN (`gin_trgm_ops`) if a workspace ever holds thousands. */
  async list(workspaceId: string, q?: string): Promise<SkillListItem[]> {
    const trimmed = q?.trim();
    const where =
      trimmed && trimmed.length > 0
        ? and(
            eq(t.skills.workspaceId, workspaceId),
            or(ilike(t.skills.name, `%${trimmed}%`), ilike(t.skills.description, `%${trimmed}%`)),
          )
        : eq(t.skills.workspaceId, workspaceId);

    const rows = await this.db
      .select({ skill: t.skills, agentCount: count(t.agentSkills.agentId) })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(where)
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name));

    return rows.map((r) => ({ ...toSkill(r.skill), agentCount: Number(r.agentCount) }));
  }

  async findById(workspaceId: string, id: string): Promise<Skill | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row ? toSkill(row) : undefined;
  }

  async insert(input: NewSkill): Promise<Skill> {
    try {
      const [row] = await this.db
        .insert(t.skills)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          description: input.description,
          type: input.type,
          source: input.source,
          body: input.body,
          enabled: input.enabled,
          needsVetting: input.needsVetting,
        })
        .returning();
      if (!row) throw new Error('insert into skills returned no row');
      return toSkill(row);
    } catch (err) {
      if (isUniqueViolation(err, SKILLS_NAME_UQ)) throw new SkillNameTakenError(input.name);
      throw err;
    }
  }

  async update(workspaceId: string, id: string, patch: SkillWritePatch): Promise<Skill | undefined> {
    try {
      const [row] = await this.db
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          needsVetting: patch.needsVetting,
          vettedBodyHash: patch.vettedBodyHash,
          ...(patch.bumpVersion ? { version: sql`${t.skills.version} + 1` } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();
      if (!row) return undefined;

      // AC-9: the version bump and its skill_versions snapshot are written in
      // the SAME db call chain as the row update — both run inside whatever
      // transaction `this.db` is bound to (the service opens one via
      // `transaction()` below before calling update()).
      if (patch.bumpVersion) {
        await this.db.insert(t.skillVersions).values({
          skillId: row.id,
          version: row.version,
          body: row.body,
        });
      }
      return toSkill(row);
    } catch (err) {
      if (isUniqueViolation(err, SKILLS_NAME_UQ) && patch.name) {
        throw new SkillNameTakenError(patch.name);
      }
      throw err;
    }
  }

  /**
   * Vet the body the person actually reviewed: one atomic UPDATE guarded by
   * `version` (which bumps on every body edit), with the hash computed by
   * Postgres from the row being updated. A concurrent body edit makes the
   * guard miss → SkillVetStaleError, never a vetted unseen body.
   */
  async vet(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const [row] = await this.db
      .update(t.skills)
      .set({
        vettedBodyHash: sql`encode(sha256(convert_to(${t.skills.body}, 'UTF8')), 'hex')`,
        needsVetting: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.skills.id, id),
          eq(t.skills.version, version),
        ),
      )
      .returning();
    if (row) return toSkill(row);
    const existing = await this.findById(workspaceId, id);
    if (!existing) return undefined;
    throw new SkillVetStaleError(version, existing.version);
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /**
   * Nested calls reuse the outer transaction (Drizzle opens a savepoint), so a
   * service can compose stores freely. Never hand a memoized container getter
   * into this callback — it is bound to the root `db`.
   */
  transaction<T>(work: (store: SkillStore) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new SkillsRepository(tx)));
  }

  // ---- cross-cutting: resolved for reviews/run-executor via container.skillsRepo

  /**
   * Effective skills for a batch of agents (SPEC-02 D1), one query, ordered by
   * `agent_skills.order`. Effective = `link.enabled && skill.enabled &&
   * !skill.needs_vetting`. Agents with no effective skill are simply absent
   * from the returned map.
   */
  async resolveEffectiveSkills(agentIds: string[]): Promise<Map<string, EffectiveSkill[]>> {
    const result = new Map<string, EffectiveSkill[]>();
    if (agentIds.length === 0) return result;

    const rows = await this.db
      .select({
        agentId: t.agentSkills.agentId,
        order: t.agentSkills.order,
        linkEnabled: t.agentSkills.enabled,
        skill: t.skills,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(inArray(t.agentSkills.agentId, agentIds))
      .orderBy(asc(t.agentSkills.order));

    for (const row of rows) {
      if (!row.linkEnabled || !row.skill.enabled || row.skill.needsVetting) continue;
      const sha256 = sha256Hex(row.skill.body);
      // Defense in depth (ADR 0012): an imported skill must carry a vet that
      // matches its CURRENT body, whatever the needs_vetting flag says.
      if (row.skill.source !== 'manual' && row.skill.vettedBodyHash !== sha256) continue;
      const list = result.get(row.agentId) ?? [];
      list.push({
        id: row.skill.id,
        name: row.skill.name,
        version: row.skill.version,
        body: row.skill.body,
        sha256,
      });
      result.set(row.agentId, list);
    }
    return result;
  }
}
