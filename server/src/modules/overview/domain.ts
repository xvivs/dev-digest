/**
 * DOMAIN — the Overview "Prepare" plan (spec 06 D7). Pure: no I/O, types only
 * from the shared kernel. `planPrepare` is the single source of "what Prepare
 * would start now"; the GET returns it as `actions`, the POST runs it.
 */
import type {
  BriefFailure,
  ExplicitAction,
  OverviewBriefStatus,
  OverviewIndexStatus,
  PrepareAction,
  PrOverviewReadiness,
} from '@devdigest/shared';

export type BlockedBy = PrOverviewReadiness['blocked_by'];

/** Facts `classifyIndex` needs; the clone fact comes only from the clone facade. */
export interface IndexFacts {
  enabled: boolean;
  cloned: boolean;
  /** `null` = not cloned or `git rev-parse HEAD` failed. */
  cloneHead: string | null;
  state: { status: 'full' | 'partial' | 'degraded' | 'failed'; lastIndexedSha: string } | null;
  versionCurrent: boolean;
}

/** First match wins (D7 table). */
export function classifyIndex(f: IndexFacts): OverviewIndexStatus {
  if (!f.enabled) return 'flag_off';
  if (!f.cloned) return 'no_clone';
  if (f.cloneHead === null) return 'no_head';
  if (!f.state) return 'missing';
  if (!f.versionCurrent) return 'outdated';
  if (f.state.status === 'degraded' || f.state.status === 'failed') return 'degraded';
  if (f.state.status === 'partial') return 'partial';
  return f.state.lastIndexedSha === f.cloneHead ? 'full' : 'stale';
}

/** The brief facade's own view decides staleness; the overview never compares shas. */
export function classifyBrief(view: { record: unknown; stale: boolean }): OverviewBriefStatus {
  if (view.record === null) return 'missing';
  return view.stale ? 'stale' : 'fresh';
}

/** `head_moved` wins over `provider_not_configured` (D7b). */
export function blockedBy(intentFailure: BriefFailure | null, risksFailure: BriefFailure | null): BlockedBy {
  const reasons = [intentFailure?.reason, risksFailure?.reason];
  if (reasons.includes('head_moved')) return 'head_moved';
  if (reasons.includes('provider_not_configured')) return 'provider_not_configured';
  return null;
}

/** Readiness without its own outputs, plus whether a partial row sits at the clone HEAD. */
export type PrepareFacts = Omit<PrOverviewReadiness, 'actions' | 'explicit_actions' | 'in_flight'> & {
  /** The index row's sha equals the clone HEAD. */
  atCloneHead: boolean;
};

/** Steps Prepare starts on its own (D7). */
export function planPrepare(f: PrepareFacts): PrepareAction[] {
  const actions: PrepareAction[] = [];
  const indexIdle = !f.index.in_flight && !f.clone.in_flight;
  switch (f.index.status) {
    case 'flag_off':
    case 'full':
      break;
    case 'no_clone':
    case 'no_head':
      // The clone job requests the index itself when it completes.
      if (!f.clone.in_flight) actions.push('clone');
      break;
    case 'missing':
    case 'outdated':
    case 'degraded':
      if (indexIdle) actions.push('index_full');
      break;
    case 'partial':
      // At the clone HEAD a full re-run ends `partial` again: explicit only (D7a).
      if (!f.atCloneHead && indexIdle) actions.push('index_full');
      break;
    case 'stale':
      if (indexIdle) actions.push('index_incremental');
      break;
  }

  // Intent reads linked docs from the clone: never derive while a clone is coming (PC-2).
  const cloneWillRun = actions.includes('clone') || f.clone.in_flight;
  const b = f.brief;
  const wantsBrief =
    b.intent !== 'fresh' || b.risks !== 'fresh' || b.intent_failure !== null || b.risks_failure !== null;
  if (!b.in_flight && f.blocked_by === null && !cloneWillRun && wantsBrief) actions.push('derive_brief');
  return actions;
}

/** Steps offered only on an explicit request (D7a). Never part of `actions`. */
export function planExplicit(f: PrepareFacts): ExplicitAction[] {
  const offer = f.index.status === 'partial' && f.atCloneHead && !f.index.in_flight && !f.clone.in_flight;
  return offer ? ['reindex_partial'] : [];
}

/** The full readiness: facts plus the plan and the top-level in-flight flag. */
export function buildReadiness(f: PrepareFacts): PrOverviewReadiness {
  const { atCloneHead: _atCloneHead, ...core } = f;
  return {
    ...core,
    actions: planPrepare(f),
    explicit_actions: planExplicit(f),
    in_flight: f.clone.in_flight || f.index.in_flight || f.brief.in_flight,
  };
}
