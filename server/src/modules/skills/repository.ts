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
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import {
  isEffectiveSkill,
  promptHashInput,
  skillUsageStatus,
  SkillNameTakenError,
  SkillVersionStaleError,
  SkillVetStaleError,
  type NewSkill,
  type Skill,
  type LinkedAgentUsage,
  type SkillLatestVerdict,
  type SkillListItem,
  type SkillRunAggregate,
  type SkillVersionSnapshot,
  type SkillVersionSummary,
} from './domain.js';
import type { SkillStatsReader, SkillStore, SkillWritePatch } from './ports.js';
import { COMPLETED_RUN_STATUS, LIST_RUNS_WINDOW_DAYS } from './constants.js';

/** A Drizzle transaction handle — structurally a `Db` for queries. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type SkillRow = typeof t.skills.$inferSelect;
type SkillVersionRow = typeof t.skillVersions.$inferSelect;

/** One effective skill resolved for a run (SPEC-02 D1 / AC-25/27). */
export interface EffectiveSkill {
  id: string;
  name: string;
  version: number;
  body: string;
  /** sha256(body) — what `vetted_body_hash` and trace `skills_used.sha256` hold. */
  sha256: string;
  /** ADR 0017 sha256(name + "\n" + body) — the text the model actually sees. */
  promptSha256: string;
}

const SKILLS_NAME_UQ = 'skills_workspace_name_uq';

/** SQL twin of `sha256Hex(promptHashInput(name, body))` over the current row. */
const PROMPT_SHA256_SQL = sql`encode(sha256(convert_to(${t.skills.name} || chr(10) || ${t.skills.body}, 'UTF8')), 'hex')`;

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

function toSnapshot(row: SkillVersionRow): SkillVersionSnapshot {
  return {
    skillId: row.skillId,
    version: row.version,
    name: row.name,
    description: row.description,
    type: row.type,
    body: row.body,
    changeNote: row.changeNote,
    createdAt: row.createdAt,
  };
}

/** Snapshot row for the skill's CURRENT state (ADR 0016: every field). */
function snapshotOf(row: SkillRow, changeNote: string | null) {
  return {
    skillId: row.id,
    version: row.version,
    body: row.body,
    name: row.name,
    description: row.description,
    type: row.type,
    changeNote,
  };
}

export class SkillsRepository implements SkillStore, SkillStatsReader {
  constructor(private readonly db: Db | Tx) {}

  /** ONE query, no N+1 (plan Phase 2-3): `agent_count` is every agent linking
   *  the skill, regardless of the link's own enabled state; `runs_30d` counts
   *  completed runs that injected it (a grouped `run_skills ⋈ agent_runs`
   *  derived table, LEFT JOINed once); and `latest_verdict` is the latest
   *  DONE FULL eval suite per skill (a `DISTINCT ON (skill_id)` derived table
   *  over the workspace's suites, LEFT JOINed once — the same shape as
   *  runs_30d instead of a per-skill LATERAL, see INSIGHTS). `stale` compares
   *  the suite's prompt_sha256 with the skill's current `sha256(name + "\n" +
   *  body)` and the carrier's version with the one it ran on (ADR 0017); a
   *  deleted carrier is stale and keeps the name it had.
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

    // Completed runs per skill over the window, aggregated ONCE for the
    // workspace (one pass over the window's runs), not re-counted per skill.
    const runs30d = this.db
      .select({
        skillId: t.runSkills.skillId,
        runs: sql<number>`count(*)::int`.as('runs'),
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkills.runId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, COMPLETED_RUN_STATUS),
          sql`${t.agentRuns.ranAt} >= now() - make_interval(days => ${LIST_RUNS_WINDOW_DAYS})`,
        ),
      )
      .groupBy(t.runSkills.skillId)
      .as('runs_30d');

    // Latest done Full suite per skill (ADR 0017: only Full yields a verdict).
    const latest = this.db
      .selectDistinctOn([t.evalSuites.skillId], {
        skillId: t.evalSuites.skillId,
        verdict: sql<string>`${t.evalSuites.results}->>'verdict'`.as('verdict'),
        carrierName: sql<string>`coalesce(${t.agents.name}, ${t.evalSuites.carrierAgentName})`.as('carrier_name'),
        promptSha256: sql<string>`${t.evalSuites.promptSha256}`.as('suite_prompt_sha256'),
        carrierMoved: sql<boolean>`(${t.agents.version} IS DISTINCT FROM ${t.evalSuites.carrierAgentVersion})`.as(
          'carrier_moved',
        ),
      })
      .from(t.evalSuites)
      .leftJoin(t.agents, eq(t.agents.id, t.evalSuites.carrierAgentId))
      .where(
        and(
          eq(t.evalSuites.workspaceId, workspaceId),
          eq(t.evalSuites.mode, 'full'),
          eq(t.evalSuites.status, 'done'),
        ),
      )
      .orderBy(t.evalSuites.skillId, desc(t.evalSuites.finishedAt), desc(t.evalSuites.createdAt))
      .as('latest_suite');

    const rows = await this.db
      .select({
        skill: t.skills,
        agentCount: count(t.agentSkills.agentId),
        // One row per skill in `runs_30d` / `latest_suite`, so max() / bool_or()
        // just lift the value past GROUP BY.
        runs30d: sql<number>`coalesce(max(${runs30d.runs}), 0)::int`,
        latestVerdict: sql<SkillLatestVerdict | null>`CASE WHEN max(${latest.verdict}) IS NULL THEN NULL ELSE jsonb_build_object(
          'verdict', max(${latest.verdict}),
          'carrierName', max(${latest.carrierName}),
          'stale', bool_or(${latest.carrierMoved} OR ${latest.promptSha256} <> ${PROMPT_SHA256_SQL})
        ) END`,
      })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .leftJoin(runs30d, eq(runs30d.skillId, t.skills.id))
      .leftJoin(latest, eq(latest.skillId, t.skills.id))
      .where(where)
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name));

    return rows.map((r) => ({
      ...toSkill(r.skill),
      agentCount: Number(r.agentCount),
      runs30d: Number(r.runs30d),
      latestVerdict: r.latestVerdict ?? null,
    }));
  }

  async findById(workspaceId: string, id: string): Promise<Skill | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row ? toSkill(row) : undefined;
  }

  /** ADR 0016: the skill row and its v1 snapshot land together (a savepoint
   *  when `this.db` is already a transaction). */
  async insert(input: NewSkill): Promise<Skill> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
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
        await tx.insert(t.skillVersions).values(snapshotOf(row, null));
        return toSkill(row);
      });
    } catch (err) {
      if (isUniqueViolation(err, SKILLS_NAME_UQ)) throw new SkillNameTakenError(input.name);
      throw err;
    }
  }

  update(workspaceId: string, id: string, patch: SkillWritePatch): Promise<Skill | undefined> {
    return this.write(workspaceId, id, patch);
  }

  /**
   * Same write as `update`, guarded by `version` like `vet`: a concurrent edit
   * moves the version, the guard misses, and the caller gets a 409 instead of
   * a restore silently overwriting that edit.
   */
  async restore(
    workspaceId: string,
    id: string,
    expectedVersion: number,
    patch: SkillWritePatch,
  ): Promise<Skill | undefined> {
    const row = await this.write(workspaceId, id, { ...patch, bumpVersion: true }, expectedVersion);
    if (row) return row;
    const existing = await this.findById(workspaceId, id);
    if (!existing) return undefined;
    throw new SkillVersionStaleError(expectedVersion, existing.version);
  }

  async listVersions(skillId: string): Promise<SkillVersionSummary[]> {
    return this.db
      .select({
        skillId: t.skillVersions.skillId,
        version: t.skillVersions.version,
        name: t.skillVersions.name,
        description: t.skillVersions.description,
        type: t.skillVersions.type,
        changeNote: t.skillVersions.changeNote,
        createdAt: t.skillVersions.createdAt,
      })
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async findVersion(skillId: string, version: number): Promise<SkillVersionSnapshot | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row ? toSnapshot(row) : undefined;
  }

  /** One UPDATE (optionally version-guarded) + the snapshot of the new state. */
  private async write(
    workspaceId: string,
    id: string,
    patch: SkillWritePatch,
    expectedVersion?: number,
  ): Promise<Skill | undefined> {
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
        .where(
          and(
            eq(t.skills.workspaceId, workspaceId),
            eq(t.skills.id, id),
            ...(expectedVersion !== undefined ? [eq(t.skills.version, expectedVersion)] : []),
          ),
        )
        .returning();
      if (!row) return undefined;

      // AC-9 / ADR 0016: the version bump and its all-field snapshot are
      // written in the SAME db call chain as the row update — both run inside
      // whatever transaction `this.db` is bound to (the service opens one via
      // `transaction()` below). Snapshot = the state AT the new version.
      if (patch.bumpVersion) {
        await this.db.insert(t.skillVersions).values(snapshotOf(row, patch.changeNote ?? null));
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
   * `version` (which bumps on every content edit, ADR 0016 — so a rename
   * during review is stale too), with the hash computed by
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

  // ---- stats (plan Phase 2)

  async listLinkedAgents(skill: Skill): Promise<LinkedAgentUsage[]> {
    const rows = await this.db
      .select({ agentId: t.agents.id, agentName: t.agents.name, linkEnabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skill.id), eq(t.agents.workspaceId, skill.workspaceId)))
      .orderBy(asc(t.agents.name));
    const bodySha256 = sha256Hex(skill.body);
    return rows.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      status: skillUsageStatus(r.linkEnabled, skill, bodySha256),
    }));
  }

  async runAggregates(workspaceId: string, skillId: string, days: number): Promise<SkillRunAggregate[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        version: t.runSkills.skillVersion,
        model: t.agentRuns.model,
        runs: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${t.runSkills.tokens}), 0)::int`,
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkills.runId))
      .where(
        and(
          eq(t.runSkills.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, COMPLETED_RUN_STATUS),
          sql`${t.agentRuns.ranAt} >= now() - make_interval(days => ${days})`,
        ),
      )
      .groupBy(t.agentRuns.agentId, t.runSkills.skillVersion, t.agentRuns.model);
    return rows.map((r) => ({ ...r, runs: Number(r.runs), tokens: Number(r.tokens) }));
  }

  // ---- cross-cutting: resolved for reviews/run-executor via container.skillsRepo

  /**
   * Effective skills for a batch of agents (SPEC-02 D1), one query, ordered by
   * `agent_skills.order`. Effective = `isEffectiveSkill()` (domain.ts).
   * Agents with no effective skill are simply absent
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
      const sha256 = sha256Hex(row.skill.body);
      // One rule with the Stats tab ([F10]): link + skill enabled, not
      // needs_vetting, and (ADR 0012 defense in depth) an imported skill's vet
      // must match its CURRENT body.
      if (!isEffectiveSkill(row.linkEnabled, row.skill, sha256)) continue;
      const list = result.get(row.agentId) ?? [];
      list.push({
        id: row.skill.id,
        name: row.skill.name,
        version: row.skill.version,
        body: row.skill.body,
        sha256,
        promptSha256: sha256Hex(promptHashInput(row.skill.name, row.skill.body)),
      });
      result.set(row.agentId, list);
    }
    return result;
  }
}
