/**
 * APPLICATION — Overview readiness and "Prepare overview" (spec 06). Reads
 * facts through the ports, lets the pure domain plan, and requests each
 * planned step independently. No LLM, GitHub or git work runs here: every
 * request only enqueues (ADR 0022).
 */
import type {
  ExplicitAction,
  PrepareAction,
  PrepareOverviewRequest,
  PrepareOverviewResponse,
  PrOverviewReadiness,
} from '@devdigest/shared';
import { blockedBy, buildReadiness, classifyBrief, classifyIndex, planExplicit, planPrepare, type PrepareFacts } from './domain.js';
import type { OverviewDeps, OverviewPull, RequestOutcome } from './ports.js';

type AnyAction = PrepareAction | ExplicitAction;

export class OverviewService {
  constructor(private deps: OverviewDeps) {}

  /** `undefined` = PR not in the workspace. */
  async readiness(workspaceId: string, prId: string): Promise<PrOverviewReadiness | undefined> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const facts = await this.facts(workspaceId, pull);
    return facts ? buildReadiness(facts) : undefined;
  }

  /**
   * Recompute readiness, run the plan (plus `reindex_partial` when asked and
   * offered), and return the readiness recomputed after the requests.
   * `undefined` = PR not in the workspace.
   */
  async prepare(
    workspaceId: string,
    prId: string,
    body: PrepareOverviewRequest = {},
  ): Promise<PrepareOverviewResponse | undefined> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const facts = await this.facts(workspaceId, pull);
    if (!facts) return undefined;

    const toRun: AnyAction[] = [...planPrepare(facts)];
    if (body.reindex_partial === true && planExplicit(facts).includes('reindex_partial')) toRun.push('reindex_partial');

    const outcomes = await Promise.allSettled(toRun.map((a) => this.request(workspaceId, pull, a)));
    const started: AnyAction[] = [];
    const failed: AnyAction[] = [];
    outcomes.forEach((o, i) => {
      const action = toRun[i]!;
      if (o.status === 'rejected') {
        this.deps.log.warn({ prId, action, err: o.reason instanceof Error ? o.reason.message : String(o.reason) }, 'overview: prepare request failed');
        failed.push(action);
      } else if (o.value === undefined || o.value.reason === 'no_handler') {
        failed.push(action);
      } else if (o.value.queued) {
        started.push(action);
      }
      // `{ queued: false }` without `no_handler` = already in flight: neither started nor failed.
    });

    const after = await this.facts(workspaceId, pull);
    if (!after) return undefined;
    return {
      status: started.length > 0 ? 'started' : 'skipped',
      started,
      failed,
      readiness: buildReadiness(after),
    };
  }

  private request(workspaceId: string, pull: OverviewPull, action: AnyAction): Promise<RequestOutcome | undefined> {
    switch (action) {
      case 'clone':
        return this.deps.clone.requestClone(workspaceId, pull.repoId);
      case 'index_full':
      case 'reindex_partial':
        return this.deps.index.requestIndex(workspaceId, pull.repoId, 'index');
      case 'index_incremental':
        return this.deps.index.requestIndex(workspaceId, pull.repoId, 'refresh');
      case 'derive_brief':
        return this.deps.brief.requestDerive(workspaceId, pull.id);
    }
  }

  private async facts(workspaceId: string, pull: OverviewPull): Promise<PrepareFacts | undefined> {
    const [clone, index, brief] = await Promise.all([
      this.deps.clone.getCloneStatus(workspaceId, pull.repoId),
      this.deps.index.getReadiness(pull.repoId),
      this.deps.brief.getPhases(workspaceId, pull.id),
    ]);
    if (!clone || !brief) return undefined;

    const status = classifyIndex({
      enabled: index.enabled,
      cloned: clone.cloned,
      cloneHead: index.cloneHead,
      state: index.state,
      versionCurrent: index.versionCurrent,
    });
    const sha = index.state?.lastIndexedSha ? index.state.lastIndexedSha : null;
    const intentFailure = brief.intent.lastFailure;
    const risksFailure = brief.risks.lastFailure;
    return {
      pr_id: pull.id,
      repo_id: pull.repoId,
      clone: {
        status: clone.cloned ? 'cloned' : 'missing',
        in_flight: clone.inFlight,
        last_failure: clone.lastFailure
          ? { reason: clone.lastFailure.reason, at: clone.lastFailure.at.toISOString() }
          : null,
      },
      index: {
        status,
        in_flight: index.inFlight,
        last_indexed_at: index.state?.lastIndexedAt ? index.state.lastIndexedAt.toISOString() : null,
        last_indexed_sha: sha,
        partial_reason: status === 'partial' ? (index.state?.partialReason ?? null) : null,
      },
      brief: {
        intent: classifyBrief(brief.intent),
        risks: classifyBrief(brief.risks),
        in_flight: brief.intent.inFlight || brief.risks.inFlight,
        intent_failure: intentFailure,
        risks_failure: risksFailure,
      },
      blocked_by: blockedBy(intentFailure, risksFailure),
      atCloneHead: sha !== null && index.cloneHead !== null && sha === index.cloneHead,
    };
  }
}
