/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

export type PartialReasonValue = 'soft_budget' | 'graph_failed' | 'parse_errors' | 'no_files';

export type DegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /** Last run that re-read the clone at a HEAD; `null` = never or not recorded. */
  lastIndexedAt: Date | null;
  /** Why a persisted `partial` row is partial, read from its stats. */
  partialReason?: PartialReasonValue;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`). Adopted by blast/service.ts in
// T2; in T1 the facade returns a degraded best-effort over container.codeIndex.
// ---------------------------------------------------------------------------

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCallerRow {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: number;
  /** file_rank.rank of the caller file (0 in the degraded/ripgrep path). */
  rank: number;
}

export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  callers: BlastCallerRow[];
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: string[];
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: DegradedReason;
  /** True when a changed symbol's callers were cut to MAX_CALLERS_PER_SYMBOL. */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Index gate + readiness (spec 06 D3, D16).
// ---------------------------------------------------------------------------

/** `index` = full index; `refresh` = incremental; `resync` = fetch + incremental. */
export type IndexRequestKind = 'index' | 'refresh' | 'resync';

/**
 * A coalesced follow-up pass after the running index body, merged by OR so no
 * accepted request is lost: `sync` = fetch origin first (resync), `full` = run
 * a full index instead of an incremental. Runs as its own job once the repo is
 * idle; `workspaceId` is the job's workspace (absent only for a job enqueued
 * without one, which the gate then cannot re-enqueue).
 */
export interface IndexTrailing {
  full: boolean;
  sync: boolean;
  workspaceId?: string;
}

export interface IndexRequestResult {
  queued: boolean;
  reason?: 'in_flight' | 'no_handler';
  /** Id of the enqueued job when `queued`. */
  jobId?: string;
}

export interface IndexReadiness {
  /** `REPO_INTEL_ENABLED`. */
  enabled: boolean;
  /** `git rev-parse HEAD` of the clone; `null` when not cloned or unreadable. */
  cloneHead: string | null;
  /** The persisted row, or `null` (no synthesis). */
  state: IndexState | null;
  /** `state.indexerVersion === INDEXER_VERSION`. */
  versionCurrent: boolean;
  /** A reservation is held or an index body is running for this repo. */
  inFlight: boolean;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;
  /**
   * The ONLY way to enqueue an index/refresh/resync job (spec 06 D4, ADR 0025).
   * Reserves the repo's in-process gate synchronously; when it is busy, no job
   * is enqueued and the request coalesces into the running job's trailing pass.
   * Tenant-agnostic: callers scope the repo to the workspace first.
   */
  requestIndex(workspaceId: string, repoId: string, kind: IndexRequestKind): Promise<IndexRequestResult>;
  /** Cheap index facts for the Overview readiness (no LLM, no blast). Never throws. */
  getIndexReadiness(repoId: string): Promise<IndexReadiness>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
}
