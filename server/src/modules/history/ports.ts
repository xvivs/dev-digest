/**
 * PORTS — what the history service needs from the outside, declared by the
 * inner ring. `repository.ts` implements `HistoryStore`; `wiring.ts` adapts the
 * container; the unit tests fake all of them.
 */
import type { PrHistoryItem, RepoRef } from '@devdigest/shared';
import type { ChangedFile, HistoryKey, PathHistoryInput } from './domain.js';

export interface HistoryPull {
  id: string;
  repoId: string;
  number: number;
  headSha: string;
  /** The base branch: history is queried against it. */
  base: string;
}

/** container.reviewRepo */
export interface PullSource {
  getPull(workspaceId: string, prId: string): Promise<HistoryPull | undefined>;
  getRepo(repoId: string): Promise<RepoRef | undefined>;
  getPrFiles(prId: string): Promise<ChangedFile[]>;
}

/** `await container.github()`; a missing token throws `ConfigError`. */
export interface PathHistory {
  list(repo: RepoRef, ref: string, paths: string[], perPath: number): Promise<PathHistoryInput[]>;
}

export interface HistoryCacheEntry extends HistoryKey {
  history: PrHistoryItem[];
  computedAt: Date;
}

export interface HistoryStore {
  get(prId: string): Promise<HistoryCacheEntry | undefined>;
  upsert(prId: string, entry: Omit<HistoryCacheEntry, 'computedAt'>): Promise<void>;
}

export interface HistoryLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}
