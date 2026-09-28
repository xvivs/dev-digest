import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { NotFoundError, AppError } from '../../platform/errors.js';
import {
  AGENT_SKILLS_BODY_BUDGET_BYTES,
  DEFAULT_AGENT_DESCRIPTION,
  INITIAL_AGENT_VERSION,
} from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
  enabled: boolean;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  /** One aggregate query (LEFT JOIN + GROUP BY) — no N+1 for `skill_count`. */
  async list(workspaceId: string): Promise<(AgentRow & { skillCount: number })[]> {
    const rows = await this.db
      .select({ agent: t.agents, skillCount: count(t.agentSkills.agentId) })
      .from(t.agents)
      .leftJoin(
        t.agentSkills,
        and(eq(t.agentSkills.agentId, t.agents.id), eq(t.agentSkills.enabled, true)),
      )
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agents.id);
    return rows.map((r) => ({ ...r.agent, skillCount: Number(r.skillCount) }));
  }

  /** Count of ENABLED skill links for one agent (SPEC-02 `skill_count`). */
  async skillCountFor(agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count(t.agentSkills.agentId) })
      .from(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.enabled, true)));
    return Number(row?.n ?? 0);
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const links = await this.linkedSkills(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills: links.map((l) => l.skill.id),
          // SPEC-02: full link state at snapshot time (AgentVersionConfig.skill_links).
          skill_links: links.map((l) => ({
            skill_id: l.skill.id,
            enabled: l.enabled,
            order: l.order,
          })),
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order, enabled: r.enabled }));
  }

  /**
   * Replace the full set of linked skills for an agent (SPEC-02 `PUT
   * /agents/:id/skills`), atomically:
   *   1. every `skill_id` must exist in this workspace, else 404 (cross-tenant
   *      guard — AC-31) — checked and thrown BEFORE any write.
   *   2. the enabled-skills body budget must not be exceeded, else 422.
   *   3. delete + insert the whole link set (order = array index).
   * All three steps run in ONE transaction: a budget/tenancy failure leaves
   * the existing links untouched (no partial write).
   */
  async setSkillLinks(
    workspaceId: string,
    agentId: string,
    links: { skillId: string; enabled: boolean }[],
  ): Promise<LinkedSkillRow[]> {
    return this.db.transaction(async (tx) => {
      const skillIds = links.map((l) => l.skillId);
      if (skillIds.length > 0) {
        const rows = await tx
          .select({ id: t.skills.id, enabled: t.skills.enabled, body: t.skills.body })
          .from(t.skills)
          .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
        if (rows.length !== new Set(skillIds).size) {
          throw new NotFoundError('One or more skills were not found in this workspace');
        }
        const byId = new Map(rows.map((r) => [r.id, r]));
        const budgetBytes = links.reduce((sum, l) => {
          if (!l.enabled) return sum;
          const skill = byId.get(l.skillId);
          if (!skill || !skill.enabled) return sum;
          return sum + Buffer.byteLength(skill.body, 'utf8');
        }, 0);
        if (budgetBytes > AGENT_SKILLS_BODY_BUDGET_BYTES) {
          throw new AppError(
            'agent_skills_budget_exceeded',
            `Enabled skills total ${budgetBytes} bytes, exceeding the ${AGENT_SKILLS_BODY_BUDGET_BYTES}-byte budget`,
            422,
            { budget_bytes: budgetBytes, limit_bytes: AGENT_SKILLS_BODY_BUDGET_BYTES },
          );
        }
      }

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (links.length > 0) {
        await tx
          .insert(t.agentSkills)
          .values(links.map((l, i) => ({ agentId, skillId: l.skillId, order: i, enabled: l.enabled })));
      }

      const rows = await tx
        .select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
        .from(t.agentSkills)
        .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
        .where(eq(t.agentSkills.agentId, agentId))
        .orderBy(asc(t.agentSkills.order));
      return rows.map((r) => ({ skill: r.skill, order: r.order, enabled: r.enabled }));
    });
  }
}
