/**
 * Repos module types. `RepoCloneFacade` is the seam other code reaches through
 * `container.repoClone` (spec 06 D5); it is type-only imported by the container,
 * so no other module ever imports this module.
 */

import type { CloneFailureReason } from '@devdigest/shared';

export interface CloneFailure {
  reason: CloneFailureReason;
  at: Date;
}

export interface CloneStatus {
  /** `repos.clone_path IS NOT NULL`. */
  cloned: boolean;
  /** A clone job is queued or running for this repo. */
  inFlight: boolean;
  /** Last failed clone job, in memory only (ADR 0020); `null` after a success, a new attempt or an API restart. */
  lastFailure: CloneFailure | null;
}

export interface CloneRequestResult {
  queued: boolean;
  reason?: 'in_flight' | 'no_handler';
}

export interface RepoCloneFacade {
  /** `undefined` = repo not in the workspace. */
  getCloneStatus(workspaceId: string, repoId: string): Promise<CloneStatus | undefined>;
  /** Enqueue a clone through the per-repo clone gate. `undefined` = repo not in the workspace. */
  requestClone(workspaceId: string, repoId: string): Promise<CloneRequestResult | undefined>;
}
