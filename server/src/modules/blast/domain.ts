/**
 * DOMAIN — pure blast-radius rules (ADR 0022 family). No I/O. `BlastInput` is a
 * module-local structural subset of repo-intel's `BlastResult` + `IndexState`:
 * nothing is imported from another module.
 */
import type { BlastReason, BlastRadius, DownstreamImpact } from '@devdigest/shared';

export interface BlastInput {
  changedSymbols: { name: string; file: string; kind: string }[];
  callers: { file: string; symbol: string; viaSymbol: string; line: number }[];
  /** Precomputed endpoints/crons per caller file; absent on the degraded path. */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  /** The result was served by the ripgrep fallback. */
  degraded?: boolean;
  /** A changed symbol's callers were cut by the per-symbol cap. */
  truncated?: boolean;
  /** The index state the result was computed against. */
  index: IndexSnapshot;
}

export interface IndexSnapshot {
  status: string;
  lastIndexedSha: string;
  indexerVersion: number;
}

export interface BlastKey {
  headSha: string;
  sourceSha: string;
  indexerVersion: number;
  indexStatus: string;
  repoIntelEnabled: boolean;
}

export type BlastVerdict = { status: 'ok'; reason: null } | { status: 'degraded'; reason: BlastReason };

/** One `DownstreamImpact` per distinct changed-symbol name (known limitation: bare names merge). */
export function toBlastRadius(input: BlastInput): BlastRadius {
  const names: string[] = [];
  for (const s of input.changedSymbols) if (!names.includes(s.name)) names.push(s.name);

  const downstream: DownstreamImpact[] = names.map((symbol) => {
    const callers = input.callers
      .filter((c) => c.viaSymbol === symbol)
      .map((c) => ({ name: c.symbol, file: c.file, line: c.line }));
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of callers) {
      const facts = input.factsByFile?.[c.file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const k of facts.crons) crons.add(k);
    }
    return {
      symbol,
      callers,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    };
  });

  const callerCount = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;
  return {
    changed_symbols: input.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind })),
    downstream,
    summary:
      `${names.length} changed symbol(s) with ${callerCount} caller(s); ` +
      `${endpointCount} endpoint(s) and ${cronCount} cron(s) affected.`,
  };
}

/** Status mapping table from the spec (flag off > partial > full/clean > no_index). */
export function blastVerdict(repoIntelEnabled: boolean, input: BlastInput): BlastVerdict {
  if (!repoIntelEnabled) return { status: 'degraded', reason: 'flag_off' };
  if (input.index.status === 'partial') return { status: 'degraded', reason: 'index_partial' };
  if (input.index.status === 'full' && !input.degraded) return { status: 'ok', reason: null };
  return { status: 'degraded', reason: 'no_index' };
}

/** The index's sha when usable; otherwise the clone's head ('' with no clone). */
export function sourceShaFor(index: IndexSnapshot, cloneHead: string): string {
  return index.status === 'full' || index.status === 'partial' ? index.lastIndexedSha : cloneHead;
}

export function sameBlastKey(a: BlastKey, b: BlastKey): boolean {
  return (
    a.headSha === b.headSha &&
    a.sourceSha === b.sourceSha &&
    a.indexerVersion === b.indexerVersion &&
    a.indexStatus === b.indexStatus &&
    a.repoIntelEnabled === b.repoIntelEnabled
  );
}
