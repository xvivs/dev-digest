/**
 * APPLICATION — prior PRs that touched the same files (ADR 0023). One GitHub
 * GraphQL request per cache miss; cached 6 h per `(head, base, paths_hash)`.
 * No SQL, no Fastify.
 */
import { ConfigError } from '../../platform/errors.js';
import { sha256Hex } from '../_shared/hash.js';
import { HISTORY_PER_PATH } from './constants.js';
import { buildHistory, isHistoryFresh, pickPaths } from './domain.js';
import type { HistoryLogger, HistoryStore, PathHistory, PullSource } from './ports.js';
import type { PrHistoryView } from './types.js';

export interface HistoryDeps {
  store: HistoryStore;
  pulls: PullSource;
  github: PathHistory;
  log: HistoryLogger;
  now?: () => number;
}

export class HistoryService {
  constructor(private deps: HistoryDeps) {}

  /** `undefined` = PR not found in the workspace (the route maps it to 404). */
  async getForPull(workspaceId: string, prId: string): Promise<PrHistoryView | undefined> {
    const { pulls, github, store, log } = this.deps;
    const nowMs = (this.deps.now ?? Date.now)();
    const pull = await pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;

    const paths = pickPaths(await pulls.getPrFiles(prId));
    if (paths.length === 0) return this.unavailable(prId, 'no_changed_files', []);

    const key = {
      headSha: pull.headSha,
      base: pull.base,
      pathsHash: sha256Hex([...paths].sort().join('\n')),
    };
    const hit = await store.get(prId);
    if (hit && isHistoryFresh(hit, key, nowMs)) {
      log.debug({ prId, cached: true, status: 'ok', reason: null, items: hit.history.length, durationMs: 0 }, 'history');
      return {
        status: 'ok',
        reason: null,
        history: hit.history,
        queriedPaths: paths,
        cached: true,
        computedAt: hit.computedAt,
      };
    }

    const repo = await pulls.getRepo(pull.repoId);
    if (!repo) return undefined;

    let rows;
    try {
      rows = await github.list(repo, pull.base, paths, HISTORY_PER_PATH);
    } catch (err) {
      if (err instanceof ConfigError) return this.unavailable(prId, 'no_github', paths);
      log.warn({ prId, reason: 'fetch_failed' }, 'history');
      return this.unavailable(prId, 'fetch_failed', paths);
    }

    const history = buildHistory(rows, pull.number);
    await store.upsert(prId, { ...key, history });
    log.debug({ prId, cached: false, status: 'ok', reason: null, items: history.length, paths: paths.length }, 'history');
    return {
      status: 'ok',
      reason: null,
      history,
      queriedPaths: paths,
      cached: false,
      computedAt: new Date(nowMs),
    };
  }

  private unavailable(
    prId: string,
    reason: 'no_github' | 'fetch_failed' | 'no_changed_files',
    paths: string[],
  ): PrHistoryView {
    this.deps.log.debug({ prId, cached: false, status: 'unavailable', reason }, 'history');
    return { status: 'unavailable', reason, history: [], queriedPaths: paths, cached: false, computedAt: null };
  }
}
