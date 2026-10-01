/**
 * PORTS — what the overview service needs from the outside. `wiring.ts` adapts
 * each one from a container seam (reviewRepo, repoClone, repoIntel, prBrief);
 * the unit tests fake all of them. The module owns no table.
 */
import type { BriefFailure, CloneFailureReason, PartialReason } from '@devdigest/shared';

export interface OverviewPull {
  id: string;
  repoId: string;
}

/** container.reviewRepo.getPull — tenancy + repoId. */
export interface PullLookup {
  getPull(workspaceId: string, prId: string): Promise<OverviewPull | undefined>;
}

/** Outcome of one gated request. `in_flight` = already running, nothing started. */
export interface RequestOutcome {
  queued: boolean;
  reason?: 'in_flight' | 'no_handler';
}

/** What the overview reads of `CloneStatus` (structural, no import of the repos module). */
export interface CloneStatusView {
  cloned: boolean;
  inFlight: boolean;
  lastFailure: { reason: CloneFailureReason; at: Date } | null;
}

/** container.repoClone */
export interface ClonePort {
  getCloneStatus(workspaceId: string, repoId: string): Promise<CloneStatusView | undefined>;
  requestClone(workspaceId: string, repoId: string): Promise<RequestOutcome | undefined>;
}

export interface IndexRow {
  status: 'full' | 'partial' | 'degraded' | 'failed';
  lastIndexedSha: string;
  lastIndexedAt: Date | null;
  partialReason: PartialReason | null;
}

export interface IndexReadinessFacts {
  enabled: boolean;
  cloneHead: string | null;
  state: IndexRow | null;
  versionCurrent: boolean;
  inFlight: boolean;
}

/** container.repoIntel (`getIndexReadiness`, `requestIndex`). */
export interface IndexPort {
  getReadiness(repoId: string): Promise<IndexReadinessFacts>;
  /** `index` = full index, `refresh` = incremental. */
  requestIndex(workspaceId: string, repoId: string, kind: 'index' | 'refresh'): Promise<RequestOutcome>;
}

export interface BriefPhase {
  /** The stored record for the PR, or `null`; only its presence is read. */
  record: unknown;
  stale: boolean;
  inFlight: boolean;
  lastFailure: BriefFailure | null;
}

/** container.prBrief */
export interface BriefPort {
  getPhases(workspaceId: string, prId: string): Promise<{ intent: BriefPhase; risks: BriefPhase } | undefined>;
  /** An on-demand derive that does nothing while one is queued or running. */
  requestDerive(workspaceId: string, prId: string): Promise<{ queued: boolean } | undefined>;
}

export interface OverviewLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface OverviewDeps {
  pulls: PullLookup;
  clone: ClonePort;
  index: IndexPort;
  brief: BriefPort;
  log: OverviewLogger;
}
