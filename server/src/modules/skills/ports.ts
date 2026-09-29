/**
 * PORTS — what the service needs from the outside world, declared by the
 * inner ring. `repository.ts` implements `SkillStore` with Drizzle; the
 * service unit test implements it in memory.
 */
import type { EvalSuiteView } from '../_shared/eval-suite.js';
import type {
  LinkedAgentUsage,
  NewSkill,
  Skill,
  SkillRunAggregate,
  SkillListItem,
  SkillVersionSnapshot,
  SkillVersionSummary,
} from './domain.js';

/** The write patch the STORE applies — the service has already resolved the
 *  vetting transition (ADR 0012); the store only persists it + the version
 *  bump mechanics (AC-9). */
export interface SkillWritePatch {
  name?: string;
  description?: string;
  type?: Skill['type'];
  body?: string;
  enabled?: boolean;
  needsVetting: boolean;
  vettedBodyHash: string | null;
  /** True when any of name/description/type/body differs from the stored
   *  value (ADR 0016) — bumps `version` and writes a `skill_versions`
   *  snapshot of every field, atomically with the rest of the patch. */
  bumpVersion: boolean;
  /** Stored on the new snapshot; ignored when `bumpVersion` is false. */
  changeNote?: string | null;
}

export interface SkillStore {
  list(workspaceId: string, q?: string): Promise<SkillListItem[]>;
  findById(workspaceId: string, id: string): Promise<Skill | undefined>;
  insert(input: NewSkill): Promise<Skill>;
  update(workspaceId: string, id: string, patch: SkillWritePatch): Promise<Skill | undefined>;
  /**
   * ADR 0016 restore: apply `patch` (always a version bump) only while the
   * skill is still at `expectedVersion` — one guarded UPDATE, modelled on
   * `vet`. Throws `SkillVersionStaleError` when the guard misses; undefined
   * when the skill is not in this workspace.
   */
  restore(
    workspaceId: string,
    id: string,
    expectedVersion: number,
    patch: SkillWritePatch,
  ): Promise<Skill | undefined>;
  /** Snapshots of one skill, newest first, without bodies. */
  listVersions(skillId: string): Promise<SkillVersionSummary[]>;
  findVersion(skillId: string, version: number): Promise<SkillVersionSnapshot | undefined>;
  /** Vet the body at exactly `version` (the one the person reviewed). */
  vet(workspaceId: string, id: string, version: number): Promise<Skill | undefined>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  /**
   * Run `work` atomically. The store handed to `work` is bound to the
   * transaction — use it, not `this`, inside the callback.
   */
  transaction<T>(work: (store: SkillStore) => Promise<T>): Promise<T>;
}

/** Reads behind `GET /skills/:id/stats` (plan Phase 2). */
export interface SkillStatsReader {
  findById(workspaceId: string, id: string): Promise<Skill | undefined>;
  /** Every agent in the skill's workspace that links it, with its
   *  `skillUsageStatus`, ordered by agent name. */
  listLinkedAgents(skill: Skill): Promise<LinkedAgentUsage[]>;
  /** ONE aggregate over `run_skills ⋈ agent_runs`: completed (`status='done'`)
   *  runs of this skill in the last `days` days, grouped by agent, skill
   *  version and model. Runs without `run_skills` rows simply do not appear. */
  runAggregates(workspaceId: string, skillId: string, days: number): Promise<SkillRunAggregate[]>;
}

/** The eval suite behind the Stats `impact` block (`container.evalsRepo`). */
export interface SkillImpactReader {
  /** Latest done Full suite of the skill, else its latest suite of any mode (per-case suites excluded). */
  findImpactSuite(workspaceId: string, skillId: string): Promise<EvalSuiteView | undefined>;
}
