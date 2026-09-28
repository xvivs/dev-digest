/**
 * APPLICATION — use cases of the `skills` module. Depends on `domain.ts` and
 * `ports.ts` only: no Drizzle, no `db/**`, no Fastify, no concrete repository.
 * Owns the ADR 0012 trust-tier decisions (import policy, vetting reset, the
 * enable gate) and the transaction boundary for `update` (AC-9); the route
 * maps the returned domain object to the HTTP DTO.
 */
import type { SkillSource, SkillStatsWindow, SkillType } from '@devdigest/shared';
import {
  applyImportPolicy,
  assertEnableAllowed,
  assertRestorableContent,
  changedContent,
  normalizeChangeNote,
  resolveVettingOnBodyEdit,
  restoreChangeNote,
  restoreTarget,
  SkillVersionNotFoundError,
  SkillVersionStaleError,
  summarizeSkillStats,
  type PriceEstimator,
  type Skill,
  type SkillListItem,
  type SkillPatch,
  type SkillStatsSummary,
  type SkillVersionSnapshot,
  type SkillVersionSummary,
} from './domain.js';
import type { SkillStatsReader, SkillStore } from './ports.js';
import { STATS_WINDOW_DAYS } from './constants.js';

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source: SkillSource;
}

export interface RestoreResult {
  skill: Skill;
  /** false = the snapshot already equals the current state; nothing written. */
  restored: boolean;
}

export class SkillsService {
  constructor(private readonly store: SkillStore) {}

  list(workspaceId: string, q?: string): Promise<SkillListItem[]> {
    return this.store.list(workspaceId, q);
  }

  get(workspaceId: string, id: string): Promise<Skill | undefined> {
    return this.store.findById(workspaceId, id);
  }

  /** ADR 0012: an import is always stored disabled + unvetted, whatever the
   *  request says — `applyImportPolicy` never reads a client-supplied
   *  enabled/needs_vetting because the input type has none. */
  create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const { enabled, needsVetting } = applyImportPolicy(input.source);
    return this.store.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      source: input.source,
      body: input.body,
      enabled,
      needsVetting,
    });
  }

  /**
   * Partial update in ONE transaction (AC-9 / D8): resolve the vetting
   * transition against the CURRENT row, refuse an enable that the same patch
   * would leave unvetted, then persist patch + version bump + `skill_versions`
   * snapshot atomically. ADR 0016: any change to name/description/type/body
   * bumps the version; `enabled` alone does not. Returns undefined when the
   * skill isn't in this workspace (route → 404).
   */
  update(workspaceId: string, id: string, patch: SkillPatch): Promise<Skill | undefined> {
    return this.store.transaction(async (tx) => {
      const existing = await tx.findById(workspaceId, id);
      if (!existing) return undefined;

      const changed = changedContent(existing, patch);
      const vetting = resolveVettingOnBodyEdit(existing, changed.body !== undefined);
      assertEnableAllowed(patch.enabled, vetting.needsVetting);

      return tx.update(workspaceId, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        needsVetting: vetting.needsVetting,
        vettedBodyHash: vetting.vettedBodyHash,
        bumpVersion: Object.keys(changed).length > 0,
        changeNote: normalizeChangeNote(patch.changeNote),
      });
    });
  }

  /** Newest first; undefined when the skill isn't in this workspace. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersionSummary[] | undefined> {
    const skill = await this.store.findById(workspaceId, id);
    if (!skill) return undefined;
    return this.store.listVersions(id);
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersionSnapshot | undefined> {
    const skill = await this.store.findById(workspaceId, id);
    if (!skill) return undefined;
    return this.store.findVersion(id, version);
  }

  /**
   * ADR 0016 restore, append-only: vN's content becomes v(current+1) with
   * `change_note = "Restored from vN"`. `expectedVersion` (the version the
   * client saw) is checked first, on the no-op path too, and again by the
   * store's guarded UPDATE. Vetting follows the edit rules (ADR 0012), and
   * the snapshot must still pass today's input limits.
   */
  restore(
    workspaceId: string,
    id: string,
    version: number,
    expectedVersion: number,
  ): Promise<RestoreResult | undefined> {
    return this.store.transaction(async (tx) => {
      const existing = await tx.findById(workspaceId, id);
      if (!existing) return undefined;
      const snapshot = await tx.findVersion(id, version);
      if (!snapshot) throw new SkillVersionNotFoundError(version);
      if (existing.version !== expectedVersion) {
        throw new SkillVersionStaleError(expectedVersion, existing.version);
      }

      const changed = changedContent(existing, restoreTarget(snapshot));
      if (Object.keys(changed).length === 0) return { skill: existing, restored: false };
      assertRestorableContent(changed);

      const vetting = resolveVettingOnBodyEdit(existing, changed.body !== undefined);
      // A restore never enables; the call keeps restore on the same gate as PUT.
      assertEnableAllowed(undefined, vetting.needsVetting);

      const skill = await tx.restore(workspaceId, id, expectedVersion, {
        ...changed,
        needsVetting: vetting.needsVetting,
        vettedBodyHash: vetting.vettedBodyHash,
        bumpVersion: true,
        changeNote: restoreChangeNote(version),
      });
      return skill ? { skill, restored: true } : undefined;
    });
  }

  /** ADR 0012: records `vetted_body_hash = sha256(body)`, clears `needs_vetting`. */
  vet(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    return this.store.vet(workspaceId, id, version);
  }

  /** Hard delete (D9): `agent_skills` links cascade; old traces keep their snapshot. */
  delete(workspaceId: string, id: string): Promise<boolean> {
    return this.store.deleteById(workspaceId, id);
  }
}

/**
 * Stats tab = Usage + Cost (plan Phase 2). Read-only: two reads through the
 * port (linked agents + ONE run aggregate), then pure `summarizeSkillStats`.
 * Separate from `SkillsService` so its unit test fakes only these reads.
 */
export class SkillStatsService {
  constructor(
    private readonly reader: SkillStatsReader,
    private readonly estimate: PriceEstimator,
  ) {}

  /** undefined when the skill isn't in this workspace (route → 404). */
  async stats(
    workspaceId: string,
    id: string,
    window: SkillStatsWindow,
  ): Promise<SkillStatsSummary | undefined> {
    const skill = await this.reader.findById(workspaceId, id);
    if (!skill) return undefined;
    const [agents, aggregates] = await Promise.all([
      this.reader.listLinkedAgents(skill),
      this.reader.runAggregates(workspaceId, id, STATS_WINDOW_DAYS[window]),
    ]);
    return summarizeSkillStats({ skillId: id, window, agents, aggregates, estimate: this.estimate });
  }
}
