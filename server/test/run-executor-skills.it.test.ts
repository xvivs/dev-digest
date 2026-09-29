/**
 * ReviewRunExecutor + skills (SPEC-02 D1 / AC-25/27): only the effective
 * skills (link.enabled && skill.enabled && !needs_vetting) are passed into
 * the prompt, in `order`; the trace's `prompt_assembly.skills_used` mirrors
 * exactly that resolved set. A disabled link and an unvetted skill are both
 * proved absent from the same run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';
import { estimateTokens } from '@devdigest/reviewer-core';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'ok',
  score: 90,
  findings: [],
};

d('ReviewRunExecutor resolves effective skills (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  async function setupPr(app: Awaited<ReturnType<typeof appWith>>) {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `skills-repo-${Date.now()}`, fullName: `acme/skills-repo-${Date.now()}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'PR',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `skills-agent-${Date.now()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();
    return { pr: pr!, agent };
  }

  /**
   * `agent_runs` turns terminal BEFORE the trace is saved, so polling the
   * status alone races the trace read. The trace is the executor's last
   * write (run_skills lands just before it); wait for it.
   */
  async function waitForTrace(runId: string, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no run_traces row for ${runId} after ${timeoutMs}ms`);
  }

  async function createSkill(app: Awaited<ReturnType<typeof appWith>>, over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: '',
        type: 'rubric',
        body: 'A short skill body.',
        ...over,
      },
    });
    return res.json();
  }

  it('agent with zero skills: no skills_used in the trace', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr, agent } = await setupPr(app);

    const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = started.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await waitForTrace(runId);

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills_used ?? null).toBeNull();
    await app.close();
  });

  it('only effective skills reach the prompt: a disabled link and an unvetted skill are excluded, order preserved', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr, agent } = await setupPr(app);

    const effective1 = await createSkill(app, { name: `eff-1-${Date.now()}`, body: 'Effective skill one.' });
    const effective2 = await createSkill(app, { name: `eff-2-${Date.now()}`, body: 'Effective skill two.' });
    const disabledLinkSkill = await createSkill(app, { name: `disabled-link-${Date.now()}` });
    const globallyDisabledSkill = await createSkill(app, { name: `globally-disabled-${Date.now()}` });
    const unvettedSkill = await createSkill(app, { name: `unvetted-${Date.now()}`, source: 'imported' });

    // Toggle one skill off globally.
    await app.inject({ method: 'PUT', url: `/skills/${globallyDisabledSkill.id}`, payload: { enabled: false } });

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: {
        links: [
          { skill_id: effective1.id, enabled: true },
          { skill_id: effective2.id, enabled: true },
          { skill_id: disabledLinkSkill.id, enabled: false },
          { skill_id: globallyDisabledSkill.id, enabled: true },
          { skill_id: unvettedSkill.id, enabled: true }, // linked but still needs_vetting
        ],
      },
    });

    const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = started.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await waitForTrace(runId);

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const used = trace.prompt_assembly.skills_used as { id: string; name: string; version: number; sha256: string; tokens: number }[];
    expect(used.map((s) => s.id)).toEqual([effective1.id, effective2.id]);
    expect(used.every((s) => s.version === 1)).toBe(true);
    expect(used.every((s) => /^[0-9a-f]{64}$/.test(s.sha256))).toBe(true);
    // skills_tokens estimates the whole rendered block (preamble + <skills> tags +
    // headings), so it is at least the sum of the per-skill body estimates.
    expect(trace.prompt_assembly.skills_tokens).toBe(
      estimateTokens(String(trace.prompt_assembly.skills)),
    );
    expect(trace.prompt_assembly.skills_tokens).toBeGreaterThanOrEqual(
      used.reduce((sum, s) => sum + s.tokens, 0),
    );

    // The names of the excluded skills never reached the prompt.
    expect(String(trace.prompt_assembly.skills ?? '')).not.toContain(disabledLinkSkill.name);
    expect(String(trace.prompt_assembly.skills ?? '')).not.toContain(globallyDisabledSkill.name);
    expect(String(trace.prompt_assembly.skills ?? '')).not.toContain(unvettedSkill.name);
    await app.close();
  });

  it('vetting an imported skill makes it effective on the NEXT run', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr, agent } = await setupPr(app);
    const imported = await createSkill(app, { name: `becomes-effective-${Date.now()}`, source: 'imported' });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: imported.id, enabled: true }] },
    });

    // Before vetting: excluded.
    const before = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await waitForTrace(before.json().runs[0].run_id);
    const beforeTrace = (
      await app.inject({ method: 'GET', url: `/runs/${before.json().runs[0].run_id}/trace` })
    ).json();
    expect(beforeTrace.prompt_assembly.skills_used ?? null).toBeNull();

    await app.inject({ method: 'POST', url: `/skills/${imported.id}/vet`, payload: { version: imported.version } });
    await app.inject({ method: 'PUT', url: `/skills/${imported.id}`, payload: { enabled: true } });

    const after = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    await waitForTrace(after.json().runs[0].run_id);
    const afterTrace = (
      await app.inject({ method: 'GET', url: `/runs/${after.json().runs[0].run_id}/trace` })
    ).json();
    expect(afterTrace.prompt_assembly.skills_used?.[0]?.id).toBe(imported.id);
    await app.close();
  });
  // ---- plan Phase 2: run_skills written next to saveRunTrace -------------

  async function linkedSkillRun(structured: unknown) {
    const app = await appWith(structured);
    const { pr, agent } = await setupPr(app);
    const skill = await createSkill(app, { name: `stats-skill-${Date.now()}`, body: 'Check auth on every route.' });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { links: [{ skill_id: skill.id, enabled: true }] },
    });
    return { app, pr, agent, skill };
  }

  it('a completed run writes one run_skills row per effective skill, with body and prompt hashes', async () => {
    const { app, pr, agent, skill } = await linkedSkillRun(REVIEW_FIXTURE);
    const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = started.json().runs[0].run_id;
    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await waitForTrace(runId);
    expect(run!.status).toBe('done');

    const rows = await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, runId));
    expect(rows).toEqual([
      {
        runId,
        skillId: skill.id,
        skillVersion: 1,
        bodySha256: sha256('Check auth on every route.'),
        promptSha256: sha256(`${skill.name}\nCheck auth on every route.`),
        tokens: estimateTokens('Check auth on every route.'),
      },
    ]);
    // The trace's skills_used.sha256 hashes the BODY only (checked for the
    // backfill): the same value as run_skills.body_sha256.
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills_used[0].sha256).toBe(rows[0]!.bodySha256);
    await app.close();
  });

  it('a failed run still writes run_skills (the failure path records skills_used too)', async () => {
    // Not a Review: structured parsing fails and the run is persisted as failed.
    const { app, pr, agent, skill } = await linkedSkillRun({ nope: true });
    const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = started.json().runs[0].run_id;
    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await waitForTrace(runId);
    expect(run!.status).toBe('failed');

    const rows = await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, runId));
    expect(rows.map((r) => r.skillId)).toEqual([skill.id]);
    await app.close();
  });

  it('a run_skills write failure is logged and never fails the run', async () => {
    const { app, pr, agent } = await linkedSkillRun(REVIEW_FIXTURE);
    await pg.handle.db.execute(sql`ALTER TABLE run_skills RENAME TO run_skills_offline`);
    try {
      const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      await waitForTrace(started.json().runs[0].run_id);
      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
      expect(run!.status).toBe('done');
      expect(run!.error).toBeNull();
    } finally {
      await pg.handle.db.execute(sql`ALTER TABLE run_skills_offline RENAME TO run_skills`);
    }
    await app.close();
  });
});
