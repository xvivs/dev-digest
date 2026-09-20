import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
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
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
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
        findingsCount: 1,
        grounding: '1/1 passed',
        score: 65,
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
