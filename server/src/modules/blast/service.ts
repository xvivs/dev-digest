/**
 * APPLICATION — blast radius for a PR. Computes against the indexed revision
 * (D14), caches per `(head, index sha, indexer version, index status, flag)` so
 * the ripgrep fallback runs once per key. No SQL, no Fastify.
 */
import { BLAST_MAPPING_VERSION } from './constants.js';
import { blastSource, blastVerdict, sameBlastKey, sourceShaFor, toBlastRadius, type BlastKey } from './domain.js';
import type {
  BlastCacheEntry,
  BlastKeySource,
  BlastLogger,
  BlastPull,
  BlastSource,
  BlastStore,
  PullSource,
} from './ports.js';
import type { BlastRadius } from '@devdigest/shared';
import type { PrBlastView } from './types.js';

export interface BlastDeps {
  store: BlastStore;
  pulls: PullSource;
  keys: BlastKeySource;
  blast: BlastSource;
  log: BlastLogger;
}

export class BlastService {
  constructor(private deps: BlastDeps) {}

  /** `undefined` = PR not found in the workspace (the route maps it to 404). */
  async getForPull(workspaceId: string, prId: string): Promise<PrBlastView | undefined> {
    const started = Date.now();
    const { pulls, keys, blast, store, log } = this.deps;

    const pull = await pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;

    const files = await pulls.getPrFiles(prId);
    if (files.length === 0) {
      const res: PrBlastView = {
        status: 'unavailable',
        reason: 'no_changed_files',
        blast: null,
        headSha: pull.headSha,
        sourceSha: null,
        indexStatus: '',
        cached: false,
        truncated: false,
        computedAt: null,
      };
      log.debug({ prId, cached: false, status: res.status, reason: res.reason, durationMs: Date.now() - started }, 'blast');
      return res;
    }

    const parts = await keys.getKey(pull.repoId);
    const key: BlastKey = {
      headSha: pull.headSha,
      sourceSha: sourceShaFor(parts.indexState, parts.cloneHead),
      indexerVersion: parts.indexState.indexerVersion,
      indexStatus: parts.indexState.status,
      repoIntelEnabled: parts.enabled,
      mappingVersion: BLAST_MAPPING_VERSION,
    };

    const hit = await store.get(prId);
    if (hit && sameBlastKey(hit, key)) {
      const res = toView(hit, true);
      logRead(log, pull, files.length, key, res, hit.blast, started);
      return res;
    }

    const result = await blast.getBlastRadius(
      pull.repoId,
      files.map((f) => f.path),
    );
    const input = { ...result, index: parts.indexState };
    const verdict = blastVerdict(parts.enabled, input);
    const entry = {
      ...key,
      status: verdict.status,
      reason: verdict.reason,
      blast: toBlastRadius(input),
      truncated: input.truncated === true,
    };
    await store.upsert(prId, entry);

    const res = toView({ ...entry, computedAt: new Date() }, false);
    logRead(log, pull, files.length, key, res, entry.blast, started);
    return res;
  }
}

/** One `info` per read: proves whether the index or a re-parse served it. Counts only, no paths. */
function logRead(
  log: BlastLogger,
  pull: BlastPull,
  changedFiles: number,
  key: BlastKey,
  res: PrBlastView,
  blast: BlastRadius,
  started: number,
): void {
  const source = blastSource(key);
  log.info(
    {
      prId: pull.id,
      repoId: pull.repoId,
      indexStatus: key.indexStatus,
      sourceSha7: key.sourceSha.slice(0, 7),
      changedFiles,
      symbols: blast.changed_symbols.length,
      callers: blast.downstream.reduce((n, d) => n + d.callers.length, 0),
      cached: res.cached,
      source,
      reparse: !res.cached && source === 'ripgrep_fallback',
      status: res.status,
      reason: res.reason,
      durationMs: Date.now() - started,
    },
    'blast index read',
  );
}

function toView(e: BlastCacheEntry, cached: boolean): PrBlastView {
  return {
    status: e.status,
    reason: e.reason,
    blast: e.blast,
    headSha: e.headSha,
    sourceSha: e.sourceSha,
    indexStatus: e.indexStatus,
    cached,
    truncated: e.truncated,
    computedAt: e.computedAt,
  };
}
