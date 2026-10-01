/**
 * Pure classifier for a terminal run failure. `status` decides first (a
 * cancelled run is never an LLM problem), then the free-text `error` the API
 * recorded. Order matters: the first matching rule wins. The category lives in
 * the next step only; the ToolError kind stays `run_failed`.
 */
export type RunErrorCategory =
  | 'cancelled'
  | 'interrupted'
  | 'deadline'
  | 'llm_key'
  | 'billing'
  | 'rate_limited'
  | 'truncated'
  | 'bad_output'
  | 'setup'
  | 'unknown';

export interface RunErrorClass {
  category: RunErrorCategory;
  nextStep: string;
}

const NEXT_STEP: Record<RunErrorCategory, string> = {
  cancelled: 'The run was cancelled by a user. Rerun if you still need the review.',
  interrupted: 'The DevDigest API restarted while the run was in progress. Rerun the agent.',
  deadline:
    'The review call hit its deadline. Raise REVIEW_CALL_DEADLINE_MS for the DevDigest API (default 900000 ms) ' +
    'and restart it, or use a map-reduce/auto strategy for this agent, then rerun.',
  llm_key: 'Check the LLM provider key in DevDigest Settings, then rerun.',
  billing: 'The LLM provider refused for billing/quota. Top up or switch the provider in Settings, then rerun.',
  rate_limited: 'The LLM provider is rate-limiting. Wait a minute and rerun.',
  truncated: 'The model output was cut at max_tokens. Rerun, or pick a model with a larger output limit for this agent.',
  bad_output: 'The model returned an unusable answer. Rerun, or switch the agent to another model.',
  setup:
    "The run failed before the model call. Check the PR is synced and the agent's skills exist, then rerun.",
  unknown: 'Read the run error above and the DevDigest API log, then rerun.',
};

const RULES: ReadonlyArray<readonly [RunErrorCategory, RegExp]> = [
  // First: the server writes these prefixes before the model call; the tail may hold a GitHub 401/429.
  ['setup', /Failed to load PR diff|Failed to resolve agent skills/i],
  ['deadline', /exceeded the \d+ s deadline/i],
  ['llm_key', /is not configured|api key|unauthori[sz]ed|\b401\b|invalid.*key|key.*invalid/i],
  ['billing', /\b402\b|insufficient credits|quota|billing/i],
  ['rate_limited', /\b429\b|rate limit/i],
  ['truncated', /max_tokens|finish_reason=length/i],
  ['bad_output', /schema validation|structured output|no choices/i],
];

export function classifyRunError(status: string | null, error: string | null): RunErrorClass {
  const pick = (category: RunErrorCategory): RunErrorClass => ({ category, nextStep: NEXT_STEP[category] });
  const text = error?.trim() ?? '';
  if (status === 'cancelled' || text.toLowerCase() === 'cancelled by user') return pick('cancelled');
  if (text === '' || text === 'Interrupted by server restart') return pick('interrupted');
  for (const [category, re] of RULES) if (re.test(text)) return pick(category);
  return pick('unknown');
}
