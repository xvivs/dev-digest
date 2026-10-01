import type { Container } from '../../platform/container.js';
import { type Repo } from '@devdigest/shared';
import { NotFoundError, NoJobHandlerError } from '../../platform/errors.js';
import { KeyedGate } from '../../platform/keyed-gate.js';
import type { RepoRepository } from './repository.js';
import { parseRepoUrl, withGitHubToken, toRepoDto, cloneUrlFor, classifyCloneFailure } from './helpers.js';
import {
  CLONE_JOB_KIND,
  CLONE_DEPTH,
  GITHUB_TOKEN_SECRET,
} from './constants.js';
import type { CloneFailure, CloneRequestResult, CloneStatus, RepoCloneFacade } from './types.js';

/**
 * F1 — repos service. Business logic for the Repositories feature:
 *   - add / list / refresh / remove
 *   - the asynchronous `clone` job (real `git clone` via the GitClient adapter)
 *   - the `RepoCloneFacade` behind `container.repoClone` (spec 06 D5)
 *
 * No HTTP and no raw SQL live here — persistence goes through RepoRepository,
 * pure transforms through helpers.ts, literals through constants.ts.
 */

/** Payload enqueued for (and consumed by) the `clone` job. */
export interface CloneJobPayload {
  repoId: string;
  owner: string;
  name: string;
  url: string;
}

export class RepoService implements RepoCloneFacade {
  /**
   * Per-repo clone gate (spec 06 D5), shared by the clone handler and the
   * facade. Per instance: the container holds exactly one `RepoService`
   * (`container.repoService`). A clone is never coalesced into a trailing
   * pass, hence `never`. The logger is read at call time.
   */
  private readonly cloneGate: KeyedGate<never>;
  /**
   * Last clone failure per repo (AR-1). In memory on the container's single
   * instance: it relies on a single API instance (ADR 0020) and is gone after
   * a restart, which only means readiness stops explaining a past failure.
   */
  private readonly cloneFailures: Map<string, CloneFailure>;

  constructor(
    private container: Container,
    private repo: RepoRepository,
  ) {
    // Assigned here, not as field initialisers: with `target: ES2022` fields
    // are defined before parameter properties, so `this.container` would be unset.
    this.cloneGate = new KeyedGate<never>((a) => a, { warn: (obj, msg) => this.container.logger?.warn(obj, msg) });
    this.cloneFailures = new Map();
  }

  /**
   * Register the `clone` job handler once. Authenticates the clone with the
   * stored GitHub PAT (so private repos work), clones via the GitClient adapter,
   * then persists the resulting path + last_polled_at.
   */
  registerCloneJobHandler(): void {
    this.container.jobs.register(CLONE_JOB_KIND, async (payload) => {
      const p = payload as CloneJobPayload;
      // A contended clone handler returns without cloning: one clone per repo at a time.
      await this.cloneGate.runExclusive(p.repoId, undefined, () => this.runCloneJob(p));
    });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url } = payload;
    const failures = this.cloneFailures;
    failures.delete(repoId); // a new attempt starts clean; success leaves it clean
    // Read before cloning: a fresh clone gets a full index, an existing one
    // (fetch only, HEAD does not move) an incremental refresh (spec 06 D4).
    const before = await this.repo.getCloneBasics(repoId);
    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    const cloneUrl = token ? withGitHubToken(url, token) : url;
    try {
      const { path } = await this.container.git.clone({ owner, name }, cloneUrl, {
        depth: CLONE_DEPTH,
      });
      await this.repo.updateClonePath(repoId, path);
    } catch (err) {
      // Only the class is kept: the raw message may carry the URL or the token.
      failures.set(repoId, { reason: classifyCloneFailure(err), at: new Date() });
      throw err;
    }

    // T2.2 — kick off the indexer in the background through the index
    // gate (`requestIndex`, never a direct enqueue), so the clone job closes
    // immediately and the (heavier) index runs as its own job. Requested
    // before the clone gate frees, so readiness never sees "cloned, nothing in
    // flight" in between. If the handler isn't registered or the facade lacks
    // the method (a test override), log nothing and continue so the clone
    // result is preserved either way.
    if (before) {
      try {
        await this.container.repoIntel.requestIndex(
          before.workspaceId,
          repoId,
          before.clonePath === null ? 'index' : 'refresh',
        );
      } catch (err) {
        // Index follow-up miss — the clone has already succeeded. The user can
        // hit Resync or Prepare overview to retry.
        this.container.logger?.warn(
          { err: err instanceof Error ? err.message : String(err), repoId },
          'index follow-up after clone failed; clone kept',
        );
      }
    }
  }

  /**
   * Reserve the clone gate and enqueue a clone job. Busy → `in_flight`, no
   * job. An enqueue error releases the reservation and propagates.
   */
  private async enqueueClone(workspaceId: string, payload: CloneJobPayload): Promise<CloneRequestResult> {
    const reservation = this.cloneGate.reserve(payload.repoId);
    if (!reservation.reserved) return { queued: false, reason: 'in_flight' };
    try {
      const job = await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, payload);
      job.done.then(reservation.release, reservation.release);
      return { queued: true };
    } catch (err) {
      reservation.release();
      throw err;
    }
  }

  /**
   * Add a repo: parse the URL, dedupe within the workspace, persist, and enqueue
   * the real clone (non-blocking). `created` is false when the repo already
   * existed (the caller returns 200 instead of 201).
   */
  async add(
    workspaceId: string,
    userId: string,
    url: string,
  ): Promise<{ repo: Repo; created: boolean }> {
    const { owner, name } = parseRepoUrl(url);
    const fullName = `${owner}/${name}`;

    const existing = await this.repo.findByFullName(workspaceId, fullName);
    if (existing) return { repo: toRepoDto(existing), created: false };

    const row = await this.repo.insert({ workspaceId, owner, name, fullName, createdBy: userId });
    await this.enqueueClone(workspaceId, { repoId: row.id, owner, name, url });

    return { repo: toRepoDto(row), created: true };
  }

  async list(workspaceId: string): Promise<Repo[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toRepoDto);
  }

  /** Re-fetch the clone for an existing repo (enqueues a fresh `clone` job). */
  async refresh(workspaceId: string, id: string): Promise<{ status: 'refreshing' }> {
    const repo = await this.repo.getById(workspaceId, id);
    if (!repo) throw new NotFoundError('Repo not found');
    // The index is requested by the clone job's own follow-up (`runCloneJob`),
    // once the fetch is done; a clone already in flight is not doubled and its
    // follow-up covers this click too. No second request here (one index per
    // click, spec 06 AC-9 / PC-9).
    await this.enqueueClone(workspaceId, {
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: cloneUrlFor(repo.fullName),
    });
    return { status: 'refreshing' };
  }

  async getCloneStatus(workspaceId: string, repoId: string): Promise<CloneStatus | undefined> {
    const repo = await this.repo.getById(workspaceId, repoId);
    if (!repo) return undefined;
    return {
      cloned: repo.clonePath !== null,
      inFlight: this.cloneGate.isBusy(repoId),
      lastFailure: this.cloneFailures.get(repoId) ?? null,
    };
  }

  async requestClone(workspaceId: string, repoId: string): Promise<CloneRequestResult | undefined> {
    const repo = await this.repo.getById(workspaceId, repoId);
    if (!repo) return undefined;
    try {
      return await this.enqueueClone(workspaceId, {
        repoId: repo.id,
        owner: repo.owner,
        name: repo.name,
        url: cloneUrlFor(repo.fullName),
      });
    } catch (err) {
      // Only a missing handler is "no_handler"; DB / queue errors propagate.
      if (err instanceof NoJobHandlerError) return { queued: false, reason: 'no_handler' };
      throw err;
    }
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.remove(workspaceId, id);
    if (!ok) throw new NotFoundError('Repo not found');
  }
}
