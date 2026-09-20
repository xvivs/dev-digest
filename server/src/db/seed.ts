import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, desc, isNull } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';
import type { RunTrace, CostSource } from '@devdigest/shared';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

// ---- run_traces helper ------------------------------------------------
// Every seeded agent_runs row should get a matching run_traces document —
// without one, `GET /runs/:id/trace` 404s and the drawer has nothing to
// show. `traceFor` derives config/stats from the run row's own columns
// (never a hardcoded number), so it stays correct if those values change.
//
// NOT used for PR #482's two 'done' runs below: their trace values are
// asserted verbatim by e2e/specs/10-run-cost-and-timeline.flow.json
// (`8.2s`, `15k→1.2k`, `$0.041`), so that block stays hand-written.

type SeededRunRow = {
  id: string;
  provider: string | null;
  model: string | null;
  status: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  findingsCount: number | null;
  grounding: string | null;
  costUsd: number | null;
  costSource: CostSource | null;
  error?: string | null;
};

/** Column set every `agentRuns` insert `.returning()`s so `traceFor` has what
 *  it needs — shared instead of retyped at each call site. */
const RUN_TRACE_RETURNING = {
  id: t.agentRuns.id,
  provider: t.agentRuns.provider,
  model: t.agentRuns.model,
  status: t.agentRuns.status,
  durationMs: t.agentRuns.durationMs,
  tokensIn: t.agentRuns.tokensIn,
  tokensOut: t.agentRuns.tokensOut,
  findingsCount: t.agentRuns.findingsCount,
  grounding: t.agentRuns.grounding,
  costUsd: t.agentRuns.costUsd,
  costSource: t.agentRuns.costSource,
  error: t.agentRuns.error,
} as const;

/** "08.20" for 8200ms — same format as the hand-written PR #482 log lines. */
function elapsedLabel(ms: number): string {
  const totalSeconds = ms / 1000;
  const whole = Math.floor(totalSeconds);
  const frac = Math.round((totalSeconds - whole) * 100);
  return `${String(whole).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}

/** Build one `run_traces` document from an already-inserted `agent_runs`
 *  row. Failed runs get a minimal `raw_output` and a `log` ending in a
 *  `kind: 'error'` line carrying the run's own `error` column, so a failed
 *  run in the timeline has something to show on click instead of a 404. */
function traceFor(
  run: SeededRunRow,
  opts: {
    agent: string;
    pr: number;
    prTitle: string;
    toolCalls?: RunTrace['tool_calls'];
    memoryPulled?: RunTrace['memory_pulled'];
    specsRead?: string[];
  },
): { runId: string; trace: RunTrace } {
  const durationMs = run.durationMs ?? 0;
  const failed = run.status !== 'done';
  const finalLine: RunTrace['log'][number] = failed
    ? { t: elapsedLabel(durationMs), kind: 'error', msg: run.error ?? 'Run failed' }
    : { t: elapsedLabel(durationMs), kind: 'result', msg: 'Review complete' };

  return {
    runId: run.id,
    trace: {
      config: {
        agent: opts.agent,
        provider: run.provider,
        model: run.model ?? DEFAULT_MODEL,
        pr: opts.pr,
        source: 'local',
      },
      stats: {
        duration_ms: durationMs,
        tokens_in: run.tokensIn ?? 0,
        tokens_out: run.tokensOut ?? 0,
        findings: run.findingsCount ?? 0,
        grounding: run.grounding ?? '0/0 passed',
        cost_usd: run.costUsd,
        cost_source: run.costSource,
        cost_missing_reason: null,
      },
      prompt_assembly: {
        system: 'You are a code reviewer. Report only issues grounded in the diff.',
        user: `Review PR #${opts.pr}: ${opts.prTitle}`,
      },
      tool_calls: opts.toolCalls ?? [],
      raw_output: failed ? '' : '{"verdict":"request_changes","findings":[]}',
      memory_pulled: opts.memoryPulled ?? [],
      specs_read: opts.specsRead ?? [],
      log: [
        { t: '00.00', kind: 'info' as const, msg: 'Run started' },
        { t: '00.12', kind: 'info' as const, msg: `Model ${run.model ?? DEFAULT_MODEL}` },
        finalLine,
      ],
    },
  };
}

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), four PRs with files/commits, sample reviews
 * with findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * The four PRs are chosen so the Pull Requests list shows every column state
 * on a clean seed: #482 needs_review (4 findings across all three severities,
 * one below the low-confidence cutoff), #479 needs_review (head moved since the
 * review), #477 reviewed (1 suggestion), #460 stale (no review at all → a dash
 * in SCORE / FINDINGS / COST).
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
      {
        // Second WARNING on purpose: with only one per severity the FINDINGS
        // column and the panel's severity filter can't be told apart from a
        // plain "one of each" fixture.
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 52,
        endLine: 52,
        severity: 'WARNING',
        category: 'bug',
        title: '`Retry-After` header omitted on 429',
        rationale:
          'The limiter returns 429 at line 52 without a `Retry-After` header, so clients have no signal for when to retry and fall back to tight retry loops.',
        suggestion: 'Set `Retry-After` to the bucket refill window (in seconds) alongside the 429.',
        confidence: 0.72,
      },
      {
        // Below LOW_CONFIDENCE_THRESHOLD (0.65) so the panel's "hide low
        // confidence" toggle actually hides something on a clean seed.
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 18,
        endLine: 18,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Bucket capacity is a bare magic number',
        rationale:
          'Line 18 hardcodes the token-bucket capacity inline; the same value is re-derived further down the file, so the two can drift apart silently.',
        suggestion: 'Lift it into a named constant next to the other limiter defaults.',
        confidence: 0.55,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // Name → id for the agents just seeded. Runs below attribute themselves with
  // this; an unattributed run makes the Review-runs card read a literal
  // "Agent" while the timeline row right above it names the reviewer.
  const agentRows = await db
    .select({ id: t.agents.id, name: t.agents.name })
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));
  const agentIdByName = new Map(agentRows.map((a) => [a.name, a.id]));

  // ---- run history for the Cost Badge (PR #482) ----
  // Three runs covering all three states the UI must render: a 'provider'
  // cost (OpenRouter returns usage.cost), an older 'estimated' cost (OpenAI/
  // Anthropic never return one — always the local price-table estimate), and
  // a failed run with no cost at all (never backfilled — a dash beats a made
  // up number). No 'running' row: reapStaleRunningRuns would flip it to
  // 'failed' on the next boot anyway.
  const [existingRun] = await db
    .select()
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, pr!.id)));
  if (!existingRun) {
    const [securityAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    const [generalAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));

    const now = Date.now();
    const HOUR = 3_600_000;
    const runs = await db.insert(t.agentRuns).values([
      {
        // Fresher run — the PR list's COST column shows THIS one.
        workspaceId,
        agentId: securityAgent?.id ?? null,
        prId: pr!.id,
        ranAt: new Date(now - 2 * HOUR),
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        status: 'done',
        durationMs: 8200,
        tokensIn: 14820,
        tokensOut: 1240,
        // Must match the seeded review above: `run_traces.stats.findings` is
        // built from this column (.returning() below), and `score` shows on the
        // same PR surface as `reviews.score` — a mismatch renders two numbers
        // for one review.
        findingsCount: 4,
        grounding: '4/4 passed',
        score: 61,
        blockers: 1,
        costUsd: 0.0412,
        costSource: 'provider',
      },
      {
        // Older run — same PR, different agent/provider, estimated cost.
        workspaceId,
        agentId: generalAgent?.id ?? null,
        prId: pr!.id,
        ranAt: new Date(now - 26 * HOUR),
        provider: 'openai',
        model: 'gpt-4.1',
        status: 'done',
        durationMs: 6400,
        tokensIn: 11200,
        tokensOut: 980,
        findingsCount: 1,
        grounding: '1/1 passed',
        score: 88,
        blockers: 0,
        costUsd: 0.0138,
        costSource: 'estimated',
      },
      {
        // Oldest run — failed before producing a review; no cost to show.
        workspaceId,
        agentId: securityAgent?.id ?? null,
        prId: pr!.id,
        ranAt: new Date(now - 50 * HOUR),
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        status: 'failed',
        durationMs: 1200,
        tokensIn: 0,
        tokensOut: 0,
        findingsCount: 0,
        grounding: '0/0 passed',
        error: 'OpenRouter returned no choices for Review: rate limited',
        costUsd: null,
        costSource: null,
      },
    ]).returning(RUN_TRACE_RETURNING);

    // One trace document per completed run. Without these the trace drawer
    // renders "No trace available yet" and its Stats block — the surface the
    // COST card lives on — never appears after a clean seed.
    const traceRows = runs
      .filter((r) => r.status === 'done')
      .map((r) => ({
        runId: r.id,
        trace: {
          config: {
            agent: r.provider === 'openai' ? 'General Reviewer' : 'Security Reviewer',
            provider: r.provider,
            model: r.model ?? DEFAULT_MODEL,
            pr: pr!.number,
            source: 'local' as const,
          },
          stats: {
            duration_ms: r.durationMs ?? 0,
            tokens_in: r.tokensIn ?? 0,
            tokens_out: r.tokensOut ?? 0,
            findings: r.findingsCount ?? 0,
            grounding: r.grounding ?? '0/0 passed',
            cost_usd: r.costUsd,
            cost_source: r.costSource,
            cost_missing_reason: null,
          },
          prompt_assembly: {
            system: 'You are a code reviewer. Report only issues grounded in the diff.',
            user: `Review PR #${pr!.number}: ${pr!.title}`,
          },
          tool_calls: [],
          raw_output: '{"verdict":"request_changes","findings":[]}',
          memory_pulled: [],
          specs_read: [],
          log: [
            { t: '00.00', kind: 'info' as const, msg: 'Run started' },
            { t: '00.12', kind: 'info' as const, msg: `Model ${r.model ?? DEFAULT_MODEL}` },
            { t: '08.20', kind: 'result' as const, msg: 'Review complete' },
          ],
        },
      }));
    if (traceRows.length > 0) {
      await db.insert(t.runTraces).values(traceRows).onConflictDoNothing();
    }

    // The failed run gets a trace too, via the shared helper — a real error
    // message beats "No trace available yet" when it's clicked in the
    // timeline. Kept out of `traceRows` above so the two 'done' runs' values
    // (asserted verbatim by the cost/timeline e2e spec) stay hand-written.
    const failedRun482 = runs.find((r) => r.status !== 'done');
    if (failedRun482) {
      const { runId, trace } = traceFor(failedRun482, {
        agent: 'Security Reviewer',
        pr: pr!.number,
        prTitle: pr!.title,
      });
      await db.insert(t.runTraces).values({ runId, trace }).onConflictDoNothing();
    }
  }

  // ---- three more PRs so the list's FINDINGS + STATUS columns show every state ----
  // The review STATUS is DERIVED (see `modules/pulls/status.ts`), never stored:
  // last_reviewed_sha vs head_sha decides needs_review/reviewed, and updated_at
  // age decides stale. The rows below are shaped to land on one state each.
  const DAY = 86_400_000;
  const HOUR_MS = 3_600_000;
  const nowMs = Date.now();

  // #479 — needs_review: reviewed at an older commit, head has moved since.
  let [pr479] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 479)));
  if (!pr479) {
    [pr479] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 479,
        title: 'Migrate sessions table to UUID primary key',
        author: 'deepak.r',
        branch: 'chore/sessions-uuid-pk',
        base: 'main',
        headSha: '7f3c91aa20de',
        lastReviewedSha: 'b0119c4e8d71', // ≠ headSha → needs_review
        additions: 412,
        deletions: 156,
        filesCount: 14,
        status: 'open',
        openedAt: new Date(nowMs - 4 * DAY),
        updatedAt: new Date(nowMs - 6 * 3_600_000),
        body: 'Swap the sessions primary key from bigserial to UUID ahead of the multi-region rollout.',
      })
      .returning();

    await db.insert(t.prFiles).values([
      { prId: pr479!.id, path: 'migrations/0042_sessions_uuid.sql', additions: 96, deletions: 0 },
      { prId: pr479!.id, path: 'src/db/sessions.ts', additions: 118, deletions: 74 },
    ]);
    await db.insert(t.prCommits).values({
      prId: pr479!.id,
      sha: '7f3c91aa20de',
      message: 'Backfill session UUIDs before dropping the serial key',
      author: 'deepak.r',
    });

    const [review479] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr479!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'The migration drops the old serial key in the same transaction that backfills UUIDs, so a mid-migration failure leaves sessions unreadable. Foreign keys pointing at the old column are also left behind.',
        score: 44,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review479!.id,
        file: 'migrations/0042_sessions_uuid.sql',
        startLine: 61,
        endLine: 74,
        severity: 'CRITICAL',
        category: 'bug',
        title: 'Backfill and column drop share one transaction',
        rationale:
          'Lines 61-74 backfill every session UUID and then drop the serial column in the same statement batch. On a table this size the backfill can time out, and the rollback leaves the app pointing at a column that no longer matches the ORM.',
        suggestion: 'Split into two migrations: backfill + dual-write first, drop the old column once the backfill is verified.',
        confidence: 0.93,
      },
      {
        reviewId: review479!.id,
        file: 'migrations/0042_sessions_uuid.sql',
        startLine: 12,
        endLine: 12,
        severity: 'WARNING',
        category: 'perf',
        title: 'Rewrite locks the sessions table with no lock timeout',
        rationale:
          'The ALTER TABLE at line 12 takes an ACCESS EXCLUSIVE lock without a `lock_timeout`, so a single long-running read blocks every session write until it finishes.',
        suggestion: 'Set a short `lock_timeout` and retry, rather than queueing behind an open transaction.',
        confidence: 0.81,
      },
      {
        reviewId: review479!.id,
        file: 'src/db/sessions.ts',
        startLine: 88,
        endLine: 95,
        severity: 'WARNING',
        category: 'bug',
        title: 'Session lookup still parses the id as an integer',
        rationale:
          'The lookup at lines 88-95 keeps `Number(id)` from the serial era, so every UUID lookup after the migration resolves to NaN and silently misses.',
        suggestion: 'Pass the id through as a string and validate it against a UUID schema.',
        confidence: 0.89,
      },
      {
        reviewId: review479!.id,
        file: 'src/db/sessions.ts',
        startLine: 21,
        endLine: 21,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Legacy `sessionIdInt` alias left in place',
        rationale:
          'Line 21 keeps the old integer-typed alias exported next to the new UUID type; nothing imports it any more.',
        suggestion: 'Remove the alias so callers cannot pick the wrong one.',
        confidence: 0.58,
      },
    ]);

    const [run479] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentIdByName.get('Security Reviewer') ?? null,
        prId: pr479!.id,
        ranAt: new Date(nowMs - 30 * 3_600_000),
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        status: 'done',
        durationMs: 11400,
        tokensIn: 21600,
        tokensOut: 1980,
        findingsCount: 4,
        grounding: '4/4 passed',
        score: 44,
        blockers: 1,
        costUsd: 0.0631,
        costSource: 'provider',
      })
      .returning(RUN_TRACE_RETURNING);

    if (run479) {
      const { runId, trace } = traceFor(run479, {
        agent: 'Security Reviewer',
        pr: pr479!.number,
        prTitle: pr479!.title,
      });
      await db.insert(t.runTraces).values({ runId, trace }).onConflictDoNothing();
    }
  }

  // #477 — reviewed: head_sha === last_reviewed_sha and touched recently.
  let [pr477] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 477)));
  if (!pr477) {
    [pr477] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 477,
        title: 'Fix flaky checkout integration test',
        author: 'tomek.w',
        branch: 'fix/flaky-checkout-it',
        base: 'main',
        headSha: 'c48d2be7f015',
        lastReviewedSha: 'c48d2be7f015', // === headSha → reviewed
        additions: 23,
        deletions: 11,
        filesCount: 2,
        status: 'open',
        openedAt: new Date(nowMs - 2 * DAY),
        updatedAt: new Date(nowMs - 3 * 3_600_000),
        body: 'The checkout suite raced the webhook fixture; await the delivery instead of sleeping.',
      })
      .returning();

    await db.insert(t.prFiles).values([
      { prId: pr477!.id, path: 'test/checkout.it.test.ts', additions: 21, deletions: 11 },
      { prId: pr477!.id, path: 'test/helpers/webhooks.ts', additions: 2, deletions: 0 },
    ]);
    await db.insert(t.prCommits).values({
      prId: pr477!.id,
      sha: 'c48d2be7f015',
      message: 'Await the webhook delivery instead of a fixed sleep',
      author: 'tomek.w',
    });

    const [review477] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr477!.id,
        kind: 'review',
        verdict: 'approve',
        summary:
          'Replaces the fixed sleep with an explicit wait on the webhook fixture. Correct fix for the race; only a naming nit left.',
        score: 92,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values({
      reviewId: review477!.id,
      file: 'test/helpers/webhooks.ts',
      startLine: 9,
      endLine: 14,
      severity: 'SUGGESTION',
      category: 'test',
      title: 'Wait helper has no upper bound',
      rationale:
        '`waitForDelivery` at lines 9-14 polls until the delivery lands with no deadline, so a genuinely dropped webhook hangs the suite until the runner kills it instead of failing with a readable message.',
      suggestion: 'Take a timeout argument and throw naming the delivery that never arrived.',
      confidence: 0.74,
    });

    const [run477] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agentIdByName.get('General Reviewer') ?? null,
        prId: pr477!.id,
        ranAt: new Date(nowMs - 5 * 3_600_000),
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        status: 'done',
        durationMs: 4300,
        tokensIn: 5200,
        tokensOut: 610,
        findingsCount: 1,
        grounding: '1/1 passed',
        score: 92,
        blockers: 0,
        costUsd: 0.0074,
        costSource: 'estimated',
      })
      .returning(RUN_TRACE_RETURNING);

    if (run477) {
      const { runId, trace } = traceFor(run477, {
        agent: 'General Reviewer',
        pr: pr477!.number,
        prTitle: pr477!.title,
      });
      await db.insert(t.runTraces).values({ runId, trace }).onConflictDoNothing();
    }
  }

  // #460 — stale: head_sha === last_reviewed_sha but untouched past STALE_DAYS.
  // Deliberately has NO review and NO runs, so the list renders a dash in the
  // SCORE / FINDINGS / COST columns (null, not an all-zero tally).
  let [pr460] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 460)));
  if (!pr460) {
    [pr460] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 460,
        title: 'Bump node 18 → 20 in CI',
        author: 'deepak.r',
        branch: 'chore/ci-node-20',
        base: 'main',
        headSha: '9ab7150c33e2',
        lastReviewedSha: '9ab7150c33e2', // === headSha, but updatedAt is old → stale
        additions: 6,
        deletions: 6,
        filesCount: 1,
        status: 'open',
        openedAt: new Date(nowMs - 40 * DAY),
        updatedAt: new Date(nowMs - 21 * DAY),
        body: 'Node 18 is out of LTS support; move the CI matrix to 20.',
      })
      .returning();

    await db.insert(t.prFiles).values({
      prId: pr460!.id,
      path: '.github/workflows/ci.yml',
      additions: 6,
      deletions: 6,
    });
    await db.insert(t.prCommits).values({
      prId: pr460!.id,
      sha: '9ab7150c33e2',
      message: 'Bump the CI node matrix to 20',
      author: 'deepak.r',
    });
  }

  // ---- second repo (xvivs/dev-digest) — the tool's own history ----
  // A real import, trimmed to a fixture: real shas, branches and diff stats, a
  // representative slice of the file list rather than all 82/125 rows, and the
  // two runs that actually reviewed PR #1.
  //
  // `clonePath` stays null on purpose. The live row points at one developer's
  // worktree, an absolute path no other machine or CI job has; the repo browses
  // fine from the seed but cannot run a review until it is re-imported.
  let [selfRepo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'xvivs/dev-digest')));
  if (!selfRepo) {
    [selfRepo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'xvivs',
        name: 'dev-digest',
        fullName: 'xvivs/dev-digest',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const selfRepoId = selfRepo!.id;

  // #1 — merged. The only merged PR in the seed: `status` holds GitHub's merge
  // state, and merged/closed PRs keep it rather than deriving a review status,
  // so this row is what exercises that branch of `modules/pulls/status.ts`.
  let [prSelf1] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, selfRepoId), eq(t.pullRequests.number, 1)));
  if (!prSelf1) {
    [prSelf1] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: selfRepoId,
        number: 1,
        title: 'feat(cost): run cost badge with provenance (L01)',
        author: 'xvivs',
        branch: 'L01',
        base: 'main',
        headSha: 'b563bce681391b9bc93cd68f7e2b124474d0e793',
        lastReviewedSha: 'b563bce681391b9bc93cd68f7e2b124474d0e793',
        additions: 6580,
        deletions: 45,
        filesCount: 82,
        status: 'merged',
        openedAt: new Date(nowMs - 2 * DAY),
        updatedAt: new Date(nowMs - DAY),
        body: "Shows what an agent run costs, on the three surfaces where you'd look for it: the PR list COST column, the trace drawer's Stats block, and the timeline row.",
      })
      .returning();

    await db.insert(t.prFiles).values([
      { prId: prSelf1!.id, path: 'specs/01-cost-badge.md', additions: 192, deletions: 0 },
      { prId: prSelf1!.id, path: 'server/test/pulls-cost.it.test.ts', additions: 142, deletions: 0 },
      { prId: prSelf1!.id, path: 'server/src/db/seed.ts', additions: 139, deletions: 0 },
      { prId: prSelf1!.id, path: 'reviewer-core/docs/prompt-contract.md', additions: 125, deletions: 0 },
      { prId: prSelf1!.id, path: 'docs/adr/0002-cost-provenance.md', additions: 124, deletions: 0 },
      { prId: prSelf1!.id, path: 'reviewer-core/test/run.test.ts', additions: 98, deletions: 1 },
    ]);

    await db.insert(t.prCommits).values([
      {
        prId: prSelf1!.id,
        sha: 'b563bce681391b9bc93cd68f7e2b124474d0e793',
        message: 'feat(cost): show run cost with its provenance on three surfaces',
        author: 'Vladyslav Semonov',
        committedAt: new Date(nowMs - 25 * HOUR_MS),
      },
      {
        prId: prSelf1!.id,
        sha: 'd16ed91d72a3253673332951f26f6c29931b5712',
        message: 'docs: add the docs/ and specs/ scaffolding CLAUDE.md already points at',
        author: 'Vladyslav Semonov',
        committedAt: new Date(nowMs - 26 * HOUR_MS),
      },
      {
        prId: prSelf1!.id,
        sha: 'dd90df88997b719a6cd4c0dcec6e9b6df0629e56',
        message: 'feat(insights): add engineering-insights skill, migrate INSIGHTS.md',
        author: 'Vladyslav Semonov',
        committedAt: new Date(nowMs - 30 * HOUR_MS),
      },
    ]);
  }

  // Two agents reviewed #1 and both approved it. Runs first, then one review
  // per run carrying its `runId` inline — the repair pass below keys on
  // (prId, kind) and would collapse both reviews onto a single run.
  const [existingSelfRun] = await db
    .select()
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prSelf1!.id)));
  if (!existingSelfRun) {
    const [securityAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    const [generalAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));

    // Real numbers from the import: a huge prompt (55k in) against a tiny
    // structured verdict (270 out) for the security pass, and a chattier
    // general pass. Both carry a 'provider' cost — OpenRouter reports usage.
    const selfRuns = await db
      .insert(t.agentRuns)
      .values([
        {
          workspaceId,
          agentId: securityAgent?.id ?? null,
          prId: prSelf1!.id,
          ranAt: new Date(nowMs - 25 * HOUR_MS),
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          status: 'done',
          durationMs: 13059,
          tokensIn: 55718,
          tokensOut: 270,
          findingsCount: 0,
          grounding: '0/0 passed',
          score: 100,
          blockers: 0,
          costUsd: 0.00506322,
          costSource: 'provider',
        },
        {
          workspaceId,
          agentId: generalAgent?.id ?? null,
          prId: prSelf1!.id,
          ranAt: new Date(nowMs - 26 * HOUR_MS),
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          status: 'done',
          durationMs: 70812,
          tokensIn: 55510,
          tokensOut: 7055,
          findingsCount: 0,
          grounding: '0/0 passed',
          score: 100,
          blockers: 0,
          costUsd: 0.01079575,
          costSource: 'provider',
        },
      ])
      .returning({ ...RUN_TRACE_RETURNING, agentId: t.agentRuns.agentId });

    // Trace per run — 1-2 plausible tool calls each, grounded in files this
    // PR actually touched (see prFiles above): the security pass grepping
    // for secrets, the general pass reading the reviewer-core diff.
    const selfTraceMeta: Array<{ agent: string; toolCalls: RunTrace['tool_calls'] }> = [
      {
        agent: 'Security Reviewer',
        toolCalls: [
          { tool: 'grep', args: 'sk_live_|sk_test_|api[_-]?key', meta: '0 matches', ms: 180 },
          { tool: 'read_file', args: 'server/src/db/seed.ts', ms: 340 },
        ],
      },
      {
        agent: 'General Reviewer',
        toolCalls: [{ tool: 'read_file', args: 'reviewer-core/src/review/run.ts', ms: 410 }],
      },
    ];
    const selfTraceRows = selfRuns.map((run, i) =>
      traceFor(run, {
        agent: selfTraceMeta[i]!.agent,
        pr: prSelf1!.number,
        prTitle: prSelf1!.title,
        toolCalls: selfTraceMeta[i]!.toolCalls,
        specsRead: ['specs/01-cost-badge.md'],
      }),
    );
    await db.insert(t.runTraces).values(selfTraceRows).onConflictDoNothing();

    // A clean approve with zero findings: the state the findings surfaces have
    // to render as "nothing to show" rather than as an empty-but-broken panel.
    await db.insert(t.reviews).values(
      selfRuns.map((run, i) => ({
        workspaceId,
        prId: prSelf1!.id,
        agentId: run.agentId,
        runId: run.id,
        kind: 'review' as const,
        verdict: 'approve',
        summary:
          i === 0
            ? 'Reviewed the entire diff for the cost badge feature (L01). The code is well-structured and shows consistent security awareness; no blocking issues found.'
            : 'Reviewed the entire diff for the cost badge feature. The implementation spans contracts, reviewer-core (cost-provenance fold, pickCost) and the server surfaces coherently.',
        score: 100,
        model: 'deepseek/deepseek-v4-flash',
      })),
    );
  }

  // #2 — open, never reviewed → derives `needs_review`.
  let [prSelf2] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, selfRepoId), eq(t.pullRequests.number, 2)));
  if (!prSelf2) {
    [prSelf2] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: selfRepoId,
        number: 2,
        title: 'feat: cost provenance, findings severity surface, and an insights workflow',
        author: 'xvivs',
        branch: 'l01-homework',
        base: 'main',
        headSha: '8d20c8c09e12867d4c9cdb4d068dd0bf7d0692e1',
        additions: 13624,
        deletions: 174,
        filesCount: 125,
        status: 'open',
        openedAt: new Date(nowMs - 4 * HOUR_MS),
        updatedAt: new Date(nowMs - 4 * HOUR_MS),
        body: 'Builds on #1: severity counts and filters on the PR list, a findings popover, and the engineering-insights workflow that keeps INSIGHTS.md machine-written.',
      })
      .returning();

    await db.insert(t.prFiles).values([
      {
        prId: prSelf2!.id,
        path: 'client/src/components/findings-popover/FindingsPopover.test.tsx',
        additions: 287,
        deletions: 0,
      },
      {
        prId: prSelf2!.id,
        path: 'client/src/components/findings-popover/FindingsPopover.tsx',
        additions: 259,
        deletions: 0,
      },
      {
        prId: prSelf2!.id,
        path: 'client/src/app/repos/[repoId]/pulls/_components/PrFindingsCell/PrFindingsCell.test.tsx',
        additions: 252,
        deletions: 0,
      },
      {
        prId: prSelf2!.id,
        path: 'client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx',
        additions: 191,
        deletions: 0,
      },
      {
        prId: prSelf2!.id,
        path: '.claude/skills/engineering-insights/SKILL.md',
        additions: 179,
        deletions: 0,
      },
      {
        prId: prSelf2!.id,
        path: '.claude/skills/engineering-insights/scripts/insert-entry.mjs',
        additions: 163,
        deletions: 0,
      },
    ]);

    await db.insert(t.prCommits).values([
      {
        prId: prSelf2!.id,
        sha: '8d20c8c09e12867d4c9cdb4d068dd0bf7d0692e1',
        message: 'docs(insights): route INSIGHTS.md writes through the skill, sharpen its triggers',
        author: 'Vladyslav Semonov',
        committedAt: new Date(nowMs - 4 * HOUR_MS),
      },
      {
        prId: prSelf2!.id,
        sha: 'a8ff6caec90030d5bd572d44de57e4f217bef4bd',
        message: "chore(insights): file this session's learnings and date the undated ones",
        author: 'Vladyslav Semonov',
        committedAt: new Date(nowMs - 4 * HOUR_MS),
      },
      {
        prId: prSelf2!.id,
        sha: '0d3ef61face09dbaa180a13c76a98c35fc6a5a81',
        message: 'feat(findings): surface severity counts, filters and a findings popover',
        author: 'Vladyslav Semonov',
        committedAt: new Date(nowMs - 5 * HOUR_MS),
      },
    ]);
  }

  // ---- link each PR's seeded review to its newest completed run ----
  // Separate idempotent pass rather than inline: the review rows are created
  // inside `if (!pr)` guards and the runs inside their own, so neither block
  // can see the other's `.returning()` value. Without run_id the Timeline and
  // the Review-runs list stay unjoined and the run drawer opens empty.
  for (const prRow of [pr, pr479, pr477]) {
    if (!prRow) continue;
    const [freshRun] = await db
      .select({ id: t.agentRuns.id, agentId: t.agentRuns.agentId })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.prId, prRow.id), eq(t.agentRuns.status, 'done')))
      .orderBy(desc(t.agentRuns.ranAt))
      .limit(1);
    if (freshRun) {
      // agentId travels with runId: the review rows are seeded before the
      // agents exist, so without this the Review-runs card falls back to the
      // literal "Agent" while the timeline row right above it names the agent.
      await db
        .update(t.reviews)
        .set({ runId: freshRun.id, agentId: freshRun.agentId })
        // No `isNull` guard: both values are derived from the newest done run,
        // so re-running the seed rewrites them with what they already hold.
        // Guarding on runId alone would strand agentId on an older seeded DB.
        .where(and(eq(t.reviews.prId, prRow.id), eq(t.reviews.kind, 'review')));
    }
  }

  // ---- backfill: run_traces for any agent_runs row that still lacks one ----
  // Not inline with the run-insert blocks above on purpose: those blocks sit
  // inside `if (!existingRun)` / `if (!pr479)` / `if (!pr477)` /
  // `if (!existingSelfRun)` guards that only fire on a CLEAN seed — on a
  // database that's already been seeded, every one of those guards is false
  // on re-run, so the `traceFor` calls next to them never execute again.
  // This pass runs unconditionally and is what actually reaches an
  // already-seeded database. LEFT JOIN + `isNull` finds every agent_runs row
  // in this workspace with no matching run_traces row, regardless of which
  // PR or seed version created it; the two PR #482 'done' runs already have
  // a trace, so the join excludes them and `onConflictDoNothing()` is the
  // second line of defense if it didn't.
  const runsMissingTrace = await db
    .select({
      id: t.agentRuns.id,
      provider: t.agentRuns.provider,
      model: t.agentRuns.model,
      status: t.agentRuns.status,
      durationMs: t.agentRuns.durationMs,
      tokensIn: t.agentRuns.tokensIn,
      tokensOut: t.agentRuns.tokensOut,
      findingsCount: t.agentRuns.findingsCount,
      grounding: t.agentRuns.grounding,
      costUsd: t.agentRuns.costUsd,
      costSource: t.agentRuns.costSource,
      error: t.agentRuns.error,
      agentName: t.agents.name,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
    })
    .from(t.agentRuns)
    .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), isNull(t.runTraces.runId)));

  const backfillTraceRows = runsMissingTrace.flatMap((r) => {
    // No PR to attribute the trace to (agentRuns.prId is nullable) — nothing
    // sane to put in config.pr/prompt_assembly.user, so skip it.
    if (r.prNumber == null || r.prTitle == null) return [];
    return [
      traceFor(r, {
        // Real agent name when the run has one; otherwise the same
        // provider-based fallback used for the hand-written PR #482 traces.
        agent: r.agentName ?? (r.provider === 'openai' ? 'General Reviewer' : 'Security Reviewer'),
        pr: r.prNumber,
        prTitle: r.prTitle,
      }),
    ];
  });
  if (backfillTraceRows.length > 0) {
    await db.insert(t.runTraces).values(backfillTraceRows).onConflictDoNothing();
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
