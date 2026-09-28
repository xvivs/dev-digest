/**
 * PORTS — what the service needs from the outside world, declared by the
 * inner ring. `repository.ts` implements `SkillStore` with Drizzle; the
 * service unit test implements it in memory.
 */
import type { NewSkill, Skill, SkillListItem } from './domain.js';

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
  /** True when `body` differs from the stored value — bumps `version` and
   *  writes a `skill_versions` row, atomically with the rest of the patch. */
  bumpVersion: boolean;
}

export interface SkillStore {
  list(workspaceId: string, q?: string): Promise<SkillListItem[]>;
  findById(workspaceId: string, id: string): Promise<Skill | undefined>;
  insert(input: NewSkill): Promise<Skill>;
  update(workspaceId: string, id: string, patch: SkillWritePatch): Promise<Skill | undefined>;
  vet(workspaceId: string, id: string): Promise<Skill | undefined>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  /**
   * Run `work` atomically. The store handed to `work` is bound to the
   * transaction — use it, not `this`, inside the callback.
   */
  transaction<T>(work: (store: SkillStore) => Promise<T>): Promise<T>;
}
