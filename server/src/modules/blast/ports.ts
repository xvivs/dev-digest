/**
 * PORTS — what the blast service needs from the outside, declared by the inner
 * ring. `repository.ts` implements `BlastStore`; `wiring.ts` adapts the
 * container; the unit tests fake all of them.
 */
import type { BlastRadius, BlastReason } from '@devdigest/shared';
import type { BlastInput, BlastKey, IndexSnapshot } from './domain.js';

export interface BlastPull {
  id: string;
  repoId: string;
  /** The persisted head: part of the cache key. */
  headSha: string;
}

/** container.reviewRepo */
export interface PullSource {
  getPull(workspaceId: string, prId: string): Promise<BlastPull | undefined>;
  getPrFiles(prId: string): Promise<{ path: string }[]>;
}

export interface BlastKeyParts {
  enabled: boolean;
  indexState: IndexSnapshot;
  /** The clone's current head; '' with no clone. */
  cloneHead: string;
}

/** Read once per GET, so the index state is never read twice. */
export interface BlastKeySource {
  getKey(repoId: string): Promise<BlastKeyParts>;
}

/** container.repoIntel.getBlastRadius, mapped to the module-local shape (without `index`). */
export interface BlastSource {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<Omit<BlastInput, 'index'>>;
}

export interface BlastCacheEntry extends BlastKey {
  status: 'ok' | 'degraded';
  reason: BlastReason | null;
  blast: BlastRadius;
  truncated: boolean;
  computedAt: Date;
}

export interface BlastStore {
  get(prId: string): Promise<BlastCacheEntry | undefined>;
  upsert(prId: string, entry: Omit<BlastCacheEntry, 'computedAt'>): Promise<void>;
}

export interface BlastLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
}
