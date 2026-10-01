/** Shared API fixtures (full server-shaped payloads; the client picks from them). */
export const REPO_ID = '11111111-1111-4111-8111-111111111111';
export const PR_ID = '22222222-2222-4222-8222-222222222222';
export const AGENT_ID = '33333333-3333-4333-8333-333333333333';
export const RUN_ID = '44444444-4444-4444-8444-444444444444';

export function repoJson(overrides: Record<string, unknown> = {}) {
  return {
    id: REPO_ID,
    workspace_id: 'ws',
    owner: 'acme',
    name: 'shop',
    full_name: 'acme/shop',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...overrides,
  };
}

export function prJson(overrides: Record<string, unknown> = {}) {
  return {
    id: PR_ID,
    number: 3,
    title: 'Add checkout',
    author: 'dev',
    branch: 'feat/checkout',
    base: 'main',
    head_sha: 'abc',
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: 'needs_review',
    ...overrides,
  };
}

export function agentJson(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    name: 'Security Reviewer',
    description: 'Finds security issues',
    provider: 'openai',
    model: 'gpt-4o-mini',
    system_prompt: 'SECRET PROMPT',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

export function runJson(overrides: Record<string, unknown> = {}) {
  return {
    run_id: RUN_ID,
    agent_id: AGENT_ID,
    agent_name: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4o-mini',
    status: 'done',
    error: null,
    duration_ms: 1234,
    tokens_in: 10,
    tokens_out: 20,
    findings_count: 2,
    grounding: null,
    ran_at: '2026-10-01T10:00:00.000Z',
    score: 80,
    blockers: 1,
    cost_usd: 0.01,
    cost_source: 'provider',
    ...overrides,
  };
}

export function findingJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    review_id: 'r1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL injection',
    file: 'src/db.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'User input reaches the query.',
    suggestion: 'Use a parameterised query.',
    confidence: 0.9,
    kind: 'finding',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

export function reviewJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    pr_id: PR_ID,
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'One critical issue.',
    score: 60,
    model: 'gpt-4o-mini',
    grounding: null,
    created_at: '2026-10-01T10:01:00.000Z',
    findings: [findingJson()],
    ...overrides,
  };
}

export function scanJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    repo_id: REPO_ID,
    status: 'done',
    commit_sha: 'abc',
    error: null,
    sample_file_count: 1,
    found_count: 1,
    verified_count: 1,
    dropped_count: 0,
    relocated_count: 0,
    matched_prior_count: 0,
    duplicate_count: 0,
    retry_count: 0,
    model: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    cost_source: null,
    started_at: '2026-10-01T09:00:00.000Z',
    finished_at: '2026-10-01T09:05:00.000Z',
    duration_ms: 300000,
    ...overrides,
  };
}

export function candidateJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    repo_id: REPO_ID,
    status: 'accepted',
    category: 'naming',
    origin: 'code',
    rule: 'Use camelCase for functions.',
    original_rule: 'Use camelCase for functions.',
    edited: false,
    evidence: [
      { path: 'src/a.ts', line_start: 1, line_end: 2, snippet: 'x' },
      { path: 'src/b.ts', line_start: 3, line_end: 4, snippet: 'y' },
      { path: 'src/c.ts', line_start: 5, line_end: 6, snippet: 'z' },
    ],
    support_count: 3,
    counter_count: 0,
    review_hits: 0,
    confidence: 0.8,
    seen_in_latest: true,
    last_seen_commit_sha: null,
    skills: [],
    created_at: '2026-10-01T09:05:00.000Z',
    ...overrides,
  };
}

export function conventionsJson(overrides: Record<string, unknown> = {}) {
  return {
    last_scan: scanJson(),
    running_scan: null,
    latest_done_scan: scanJson(),
    candidates: [candidateJson()],
    ...overrides,
  };
}

/** Full `GET /pulls/:id/blast` payload, including fields the MCP client drops. */
export function blastJson(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    reason: null,
    blast: {
      changed_symbols: [{ name: 'chargeCard', file: 'src/pay.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'chargeCard',
          callers: [{ name: 'checkout', file: 'src/checkout.ts', line: 42 }],
          endpoints_affected: ['POST /checkout'],
          crons_affected: [],
        },
      ],
      summary: '1 changed symbol, 1 caller.',
    },
    head_sha: 'abc',
    source_sha: 'def',
    index_status: 'full',
    cached: false,
    truncated: false,
    computed_at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}
