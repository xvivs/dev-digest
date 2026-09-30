/**
 * Brief module literals (ADR 0022). Caps, budgets and thresholds live here so
 * the domain, the prompt builders and the service agree on one value.
 */

export const BRIEF_JOB_KIND = 'brief.derive';

// ---- Scheduling ------------------------------------------------------------
/** PRs scheduled per `scheduleFor*` call (the repository query has no LIMIT). */
export const AUTO_BRIEF_MAX_PER_SYNC = 10;
/** Automatic attempts per (prId, head_sha); `head_moved` does not count. After that only the button retries. */
export const AUTO_BRIEF_MAX_ATTEMPTS = 3;
/** Cap per in-memory failure/negative/attempt map; the oldest entry drops first (spec D10). */
export const BRIEF_STATE_MAX_ENTRIES = 5000;
/** TTL of a negative-cache entry keyed (prId, head_sha, phase). */
export const NEGATIVE_CACHE_TTL_MS = 10 * 60_000;

// ---- Budgets (each an AbortSignal over its whole phase; 45 + 60 < the runner's 150 s) ----
export const INTENT_BUDGET_MS = 45_000;
export const RISKS_BUDGET_MS = 60_000;
/** Per-call LLM timeout ceiling; the call gets min(this, budget remaining). */
export const LLM_CALL_TIMEOUT_MS = 30_000;
/** JobRunner timeoutMs for briefJobs. */
export const BRIEF_JOB_TIMEOUT_MS = 150_000;
/** Budget for the one forced `fetchPullHead` retry when `head_sha` is missing in the clone. */
export const FETCH_HEAD_BUDGET_MS = 15_000;

// ---- Link resolution (D6) ---------------------------------------------------
export const MAX_LINKED_DOCS = 3;
export const MAX_LINKED_ISSUES = 1;
export const DOC_EXTENSIONS = ['md', 'mdx', 'txt', 'rst', 'adoc'] as const;
/** Bytes `readFileAtRef` may read per doc. */
export const DOC_READ_MAX_BYTES = 64 * 1024;
/** An unresolved link whose url matches this lowers the confidence cap to `medium` (D7). */
/** Stored unresolved links per PR (a body full of URLs must not bloat the row). */
export const MAX_UNRESOLVED_LINKS = 20;
export const SPEC_LIKE_RE = /spec|plan|design|rfc|adr/i;

// ---- Confidence (D7) --------------------------------------------------------
export const RICH_DESCRIPTION_CHARS = 200;
export const MIN_DESCRIPTION_CHARS = 40;

// ---- Intent prompt input caps ------------------------------------------------
export const INTENT_TITLE_MAX = 300;
export const INTENT_BODY_MAX = 4000;
export const INTENT_COMMITS_MAX = 30;
export const INTENT_COMMIT_LINE_MAX = 200;
export const INTENT_PATHS_MAX = 100;
export const INTENT_ISSUE_BODY_MAX = 3000;
export const INTENT_DOC_MAX = 6000;
export const INTENT_TOTAL_MAX = 24_000;

// ---- Intent output clamps ----------------------------------------------------
export const INTENT_OUT_MAX = 400;
export const SCOPE_ITEMS_MAX = 8;
export const SCOPE_ITEM_MAX = 200;
export const INTENT_MAX_OUTPUT_TOKENS = 800;

// ---- Risk prompt input caps ---------------------------------------------------
export const RISK_PATCH_PER_FILE_MAX = 3000;
export const RISK_PATCHES_TOTAL_MAX = 30_000;
export const RISK_FILES_LISTED_MAX = 200;

// ---- Risk output clamps --------------------------------------------------------
export const RISKS_MAX = 6;
export const RISK_TITLE_MAX = 80;
export const RISK_EXPLANATION_MAX = 400;
export const RISK_REFS_MAX = 5;
export const RISK_MAX_OUTPUT_TOKENS = 1200;

// ---- LLM call options ------------------------------------------------------------
export const LLM_TEMPERATURE = 0;
export const LLM_MAX_RETRIES = 1;
export const INTENT_SCHEMA_NAME = 'pr_intent';
export const RISKS_SCHEMA_NAME = 'pr_risks';

// ---- Risk rules (D9) ----------------------------------------------------------------
export const DEP_MANIFESTS = [
  'package.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'Gemfile',
] as const;
export const DEP_LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'go.sum',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
] as const;
/** `requirements.txt`, `requirements-dev.txt`, ... */
export const REQUIREMENTS_RE = /^requirements.*\.txt$/;
export const MIGRATION_PATH_RES: readonly RegExp[] = [
  /(^|\/)(migrations?|migrate)\//,
  /\.sql$/,
  /(^|\/)prisma\/migrations\//,
];
/** Paths listed in a rule risk's file_refs. */
export const RULE_REFS_MAX = 20;
export const DESTRUCTIVE_SQL_RE = /\b(DROP|TRUNCATE)\b|\bALTER\s+TABLE\b[^;]*\b(DROP|RENAME)\b/i;
