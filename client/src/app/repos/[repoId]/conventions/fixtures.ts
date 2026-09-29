/* Test fixtures for the Conventions route: valid contract objects with sensible
   defaults, so a test states only what it cares about. Not imported by app code. */
import type { ConventionCandidate, ConventionScan, ConventionsPage } from "@devdigest/shared";

export function candidate(id: string, over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id,
    repo_id: "repo-1",
    status: "pending",
    category: "async",
    origin: "code",
    rule: `Rule number ${id} for the team`,
    original_rule: `Rule number ${id} for the team`,
    edited: false,
    evidence: [{ path: "src/api/users.ts", line_start: 23, line_end: 31, snippet: "const user = await db.users.find(id);" }],
    support_count: 3,
    counter_count: 0,
    review_hits: 0,
    confidence: 0.91,
    seen_in_latest: true,
    last_seen_commit_sha: "abc1234",
    skills: [],
    created_at: "2026-09-29T10:00:00.000Z",
    ...over,
  };
}

export function scan(over: Partial<ConventionScan> = {}): ConventionScan {
  return {
    id: "scan-1",
    repo_id: "repo-1",
    status: "done",
    commit_sha: "abc1234",
    error: null,
    sample_file_count: 84,
    found_count: 5,
    verified_count: 3,
    dropped_count: 2,
    relocated_count: 1,
    matched_prior_count: 0,
    duplicate_count: 0,
    retry_count: 0,
    model: "deepseek/deepseek-v4-flash",
    tokens_in: 12300,
    tokens_out: 950,
    cost_usd: 0.0012,
    cost_source: "estimated",
    started_at: "2026-09-29T09:00:00.000Z",
    finished_at: "2026-09-29T09:00:42.000Z",
    duration_ms: 42000,
    ...over,
  };
}

export function page(over: Partial<ConventionsPage> = {}): ConventionsPage {
  const done = scan();
  return { last_scan: done, running_scan: null, latest_done_scan: done, candidates: [], ...over };
}
