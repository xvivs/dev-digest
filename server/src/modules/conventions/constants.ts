/** Constants for the conventions extractor (specs/02-conventions.md, Non-functional). */
import type { ProviderRouting } from '@devdigest/shared';

/** JobRunner kind for one scan. */
export const CONVENTIONS_JOB_KIND = 'conventions.extract';

/** AC-17: a scan handler aborts the LLM call this long after it started. */
export const SCAN_DEADLINE_MS = 100_000;

// ---- SAMPLE (AC-10) --------------------------------------------------------
/** Code files per sample (forced files included). */
export const MAX_CODE_FILES = 12;
/** Files forced into the sample by recurring review findings (AC-12). */
export const MAX_FORCED_FILES = 4;
export const MAX_CONFIG_FILES = 4;
/** Stratification: at most this many code files per directory group. */
export const PER_GROUP_LIMIT = 3;
/** Ranked paths fetched from Repo Intel before stratifying. */
export const RANKED_FETCH = 200;
export const FILE_MAX_LINES = 200;
export const FILE_MAX_BYTES = 6 * 1024;
/** Total rendered sample (gutters included); files past it are not sent (Trap 6). */
export const SAMPLE_MAX_BYTES = 60 * 1024;

/**
 * Config files tried in this order; each inner list is one slot and the first
 * readable, non-empty alternative wins. Missing / unreadable / empty ones are
 * skipped without failing the scan (G8). They are context only (D12): VERIFY
 * never accepts them as evidence.
 */
export const CONFIG_FILE_SLOTS: readonly (readonly string[])[] = [
  ['AGENTS.md'],
  ['CLAUDE.md'],
  ['CONTRIBUTING.md'],
  ['package.json'],
  ['tsconfig.json'],
  [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yml',
    '.eslintrc.yaml',
  ],
  ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yml', '.prettierrc.yaml'],
  ['biome.json'],
  ['.editorconfig'],
];

// ---- Review history (AC-12, D13) -------------------------------------------
export const RECURRING_MIN_PRS = 2;
export const RECURRING_LIMIT = 10;

// ---- Prior decisions (D6) --------------------------------------------------
export const PRIOR_LIMIT = 40;

// ---- PROPOSE (AC-13) -------------------------------------------------------
export const MAX_OUTPUT_TOKENS = 6000;
/** Structured-output repair attempts only; SDK retries are 0 (per-request signal). */
export const LLM_MAX_RETRIES = 1;
export const LLM_TEMPERATURE = 0;
export const MAX_CANDIDATES = 8;
/** `observed_patterns` survey written before the candidates (see prompt.ts). */
export const MAX_OBSERVED_PATTERNS = 5;
export const MAX_QUOTES = 3;
export const QUOTE_MAX = 240;
export const RULE_MIN = 8;
export const RULE_MAX = 300;
export const LLM_SCHEMA_NAME = 'ConventionExtraction';
/**
 * OpenRouter upstream routing for the PROPOSE call (AC-13, Non-functional).
 * One model id is served by ~15 upstreams, and the default price-weighted load
 * balancing picks a random one per call. Measured on deepseek-v4-flash with a
 * 13-file, ~16k-token sample (2026-09-30): Alibaba (first under `throughput`)
 * 10-15 s, 5/5 and 8/8 verified; Relace (first under `latency` and the price
 * default) 7-10 s but once 0/5 verified. The previous round saw DeepInfra and
 * DigitalOcean return `[]` in 2-3 s and one unknown upstream send nothing
 * before the 100 s deadline. So: sort by throughput (a fast upstream finishes a
 * ~2k-token answer well inside the deadline), skip the two that returned
 * empty lists, and keep fallbacks on so one upstream outage does not fail the
 * scan. Re-measure when the default model changes: the slugs are per model.
 */
export const CONVENTIONS_PROVIDER_ROUTING: ProviderRouting = {
  sort: 'throughput',
  ignore: ['deepinfra', 'digitalocean'],
  allowFallbacks: true,
};

// ---- VERIFY (AC-14..16) ----------------------------------------------------
/** A quote with fewer non-whitespace characters cannot identify a line (G3). */
export const QUOTE_MIN_NON_WS = 8;
export const SNIPPET_MAX_LINES = 12;
export const CONFIDENCE_WEIGHTS = {
  llm: 0.45,
  support: 0.45,
  signal: 0.1,
  counter: 0.3,
} as const;
/** Support saturates at this many distinct files. */
export const SUPPORT_SATURATION = 3;
/** Confidence cap when support < 2 (one cited file). */
export const SINGLE_FILE_CONFIDENCE_CAP = 0.59;

// ---- PERSIST (AC-22) -------------------------------------------------------
/** Newest scans kept per repo, plus any scan a convention still points at. */
export const SCAN_RETENTION = 10;

/** Error text of scans left `running` by a dead process (AC-18). */
export const REAPED_SCAN_ERROR = 'interrupted: the server restarted while the scan was running';
