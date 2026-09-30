/**
 * Brief module types (ADR 0022). `PrBriefFacade` is the seam other code reaches
 * through `container.prBrief`; it is type-only imported by the container, so no
 * other module ever imports this module.
 */
import type { BriefFailure, BriefFailureReason, PrIntentRecord, PrRisksRecord } from '@devdigest/shared';
import type { IntentInput } from '@devdigest/reviewer-core';

/** Where a scheduling pass came from (import paths). */
export type ImportTrigger = 'list_sync' | 'poll' | 'detail';
/** Every way a derivation can be requested. */
export type BriefTrigger = ImportTrigger | 'on_demand' | 'review_prework';

/** The two LLM phases of one `brief.derive` job. */
export type BriefPhase = 'intent' | 'risks';

/** Failure reasons that are negative-cached (10 min) per (prId, head_sha, phase). */
export const NEGATIVE_CACHED_REASONS: readonly BriefFailureReason[] = ['timeout', 'llm_error', 'parse_error'];

/** Service view of a stored intent plus its derived flags (the route maps it to the DTO). */
export interface PrIntentView {
  record: PrIntentRecord | null;
  stale: boolean;
  inFlight: boolean;
  lastFailure: BriefFailure | null;
}

export interface PrRisksView {
  record: PrRisksRecord | null;
  stale: boolean;
  inFlight: boolean;
  lastFailure: BriefFailure | null;
}

export type FreshIntent =
  | {
      ok: true;
      intent: IntentInput;
      headSha: string;
      provider: string | null;
      model: string | null;
    }
  | { ok: false; reason: 'missing' | 'stale' };

/** Payload of a `brief.derive` job. */
export interface DerivePayload {
  workspaceId: string;
  prId: string;
  trigger: BriefTrigger;
  /** ISO time of the enqueue, for the freshness skip. */
  enqueuedAt: string;
}

export type DeriveOutcome =
  | { ok: true }
  | { ok: false; reason: BriefFailureReason };

export interface PrBriefFacade {
  getIntent(workspaceId: string, prId: string): Promise<PrIntentView | undefined>;
  getRisks(workspaceId: string, prId: string): Promise<PrRisksView | undefined>;
  /**
   * Queue a derivation. Every trigger except `on_demand` passes the automatic
   * gate first. Only `on_demand` rethrows an enqueue failure; the rest resolve
   * `{ queued: false }`. `undefined` = the PR is not in this workspace.
   */
  requestDerive(
    workspaceId: string,
    prId: string,
    trigger: BriefTrigger,
  ): Promise<{ queued: boolean } | undefined>;
  /** Schedule the open PRs of a repo that lack a current intent/risks row. Never rejects. */
  scheduleForRepo(workspaceId: string, repoId: string, trigger: ImportTrigger): Promise<void>;
  /** Schedule one PR. Never rejects. */
  scheduleForPull(workspaceId: string, prId: string, trigger: ImportTrigger): Promise<void>;
  /** Review pre-work: read only, no LLM, no network. */
  readFreshIntent(prId: string, headSha: string): Promise<FreshIntent>;
  /** Effective workspace `automatic_brief` (missing row = ON). Uncached; does not touch the gate. */
  isAutomaticEnabled(workspaceId: string): Promise<boolean>;
  /** Job handler entry. Never throws. */
  derive(workspaceId: string, prId: string, payload: DerivePayload): Promise<DeriveOutcome>;
  isInFlight(prId: string): boolean;
}
