import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, desc } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

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
    ]).returning({
      id: t.agentRuns.id,
      model: t.agentRuns.model,
      provider: t.agentRuns.provider,
      status: t.agentRuns.status,
      durationMs: t.agentRuns.durationMs,
      tokensIn: t.agentRuns.tokensIn,
      tokensOut: t.agentRuns.tokensOut,
      findingsCount: t.agentRuns.findingsCount,
      grounding: t.agentRuns.grounding,
      costUsd: t.agentRuns.costUsd,
      costSource: t.agentRuns.costSource,
    });

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
  }

  // ---- three more PRs so the list's FINDINGS + STATUS columns show every state ----
  // The review STATUS is DERIVED (see `modules/pulls/status.ts`), never stored:
  // last_reviewed_sha vs head_sha decides needs_review/reviewed, and updated_at
  // age decides stale. The rows below are shaped to land on one state each.
  const DAY = 86_400_000;
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

    await db.insert(t.agentRuns).values({
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
    });
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

    await db.insert(t.agentRuns).values({
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
    });
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
