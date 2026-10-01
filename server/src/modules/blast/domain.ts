/**
 * DOMAIN — pure blast-radius rules (ADR 0022 family). No I/O. `BlastInput` is a
 * module-local structural subset of repo-intel's `BlastResult` + `IndexState`:
 * nothing is imported from another module.
 */
import type { BlastReason, BlastRadius, DownstreamImpact } from '@devdigest/shared';

/** Module-local mirror of the facade's degraded reasons (nothing is imported from repo-intel). */
export type FacadeDegradedReason = 'flag_off' | 'index_failed' | 'index_partial' | 'repo_too_large' | 'no_data';

export interface BlastInput {
  changedSymbols: { name: string; file: string; kind: string }[];
  callers: { file: string; symbol: string; viaSymbol: string; line: number; rank: number }[];
  /** Precomputed endpoints/crons per caller file; absent on the degraded path. */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  /** The result was served by the ripgrep fallback. */
  degraded?: boolean;
  /** Why the facade degraded (set with `degraded`). */
  reason?: FacadeDegradedReason;
  /** A changed symbol's callers were cut by the per-symbol cap. */
  truncated?: boolean;
  /** The index state the result was computed against. */
  index: IndexSnapshot;
}

export interface IndexSnapshot {
  status: string;
  lastIndexedSha: string;
  indexerVersion: number;
  /** The facade's own reason when the index is degraded/failed/missing. */
  degradedReason?: FacadeDegradedReason;
}

export interface BlastKey {
  headSha: string;
  sourceSha: string;
  indexerVersion: number;
  indexStatus: string;
  repoIntelEnabled: boolean;
  mappingVersion: number;
}

export type BlastVerdict = { status: 'ok'; reason: null } | { status: 'degraded'; reason: BlastReason };

type RankedCaller = { name: string; file: string; line: number; rank: number };

const cmp = <T>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One `DownstreamImpact` per distinct changed-symbol name (known limitation: bare names merge).
 * Order (spec 08, D6): callers by rank desc, file, line; groups by max caller rank desc
 * (no callers last), caller count desc, symbol; `changed_symbols` follow the group order.
 * A caller living in the declaring file of its `viaSymbol` is dropped (D7).
 */
export function toBlastRadius(input: BlastInput): BlastRadius {
  const names: string[] = [];
  for (const s of input.changedSymbols) if (!names.includes(s.name)) names.push(s.name);
  const declFiles = new Map<string, Set<string>>();
  for (const s of input.changedSymbols) {
    const set = declFiles.get(s.name) ?? new Set<string>();
    set.add(s.file);
    declFiles.set(s.name, set);
  }

  const groups = names.map((symbol) => {
    const ranked: RankedCaller[] = input.callers
      .filter((c) => c.viaSymbol === symbol && !declFiles.get(symbol)?.has(c.file))
      .map((c) => ({ name: c.symbol, file: c.file, line: c.line, rank: c.rank }))
      .sort((x, y) => y.rank - x.rank || cmp(x.file, y.file) || x.line - y.line);
    const callers = ranked.map(({ name, file, line }) => ({ name, file, line }));
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of callers) {
      const facts = input.factsByFile?.[c.file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const k of facts.crons) crons.add(k);
    }
    const impact: DownstreamImpact = {
      symbol,
      callers,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    };
    return { impact, maxRank: ranked.length > 0 ? ranked[0]!.rank : -Infinity };
  });
  groups.sort(
    (x, y) =>
      (x.maxRank === y.maxRank ? 0 : x.maxRank < y.maxRank ? 1 : -1) ||
      y.impact.callers.length - x.impact.callers.length ||
      cmp(x.impact.symbol, y.impact.symbol),
  );
  const downstream = groups.map((g) => g.impact);
  const position = new Map(downstream.map((d, i) => [d.symbol, i]));
  const changed = input.changedSymbols
    .map((s) => ({ name: s.name, file: s.file, kind: s.kind }))
    .sort((x, y) => position.get(x.name)! - position.get(y.name)! || cmp(x.file, y.file));

  const callerCount = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;
  return {
    changed_symbols: changed,
    downstream,
    summary:
      `${changed.length} changed symbol(s) with ${callerCount} caller(s); ` +
      `${endpointCount} endpoint(s) and ${cronCount} cron(s) affected.`,
  };
}

/** Status mapping table (spec 08, D4): flag off > partial > full/clean > full/fallback > failed > rest. */
export function blastVerdict(repoIntelEnabled: boolean, input: BlastInput): BlastVerdict {
  if (!repoIntelEnabled) return { status: 'degraded', reason: 'flag_off' };
  const { index } = input;
  if (index.status === 'partial') return { status: 'degraded', reason: 'index_partial' };
  if (index.status === 'full') {
    return input.degraded ? { status: 'degraded', reason: input.reason ?? 'no_data' } : { status: 'ok', reason: null };
  }
  if (index.status === 'failed') return { status: 'degraded', reason: index.degradedReason ?? 'index_failed' };
  return { status: 'degraded', reason: index.degradedReason ?? 'no_data' };
}

/** Which source serves a key: the persistent index, or the ripgrep fallback. */
export function blastSource(key: BlastKey): 'index' | 'ripgrep_fallback' {
  return key.repoIntelEnabled && (key.indexStatus === 'full' || key.indexStatus === 'partial')
    ? 'index'
    : 'ripgrep_fallback';
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
    a.repoIntelEnabled === b.repoIntelEnabled &&
    a.mappingVersion === b.mappingVersion
  );
}
