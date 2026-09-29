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
import { applySourcePolicy } from '../src/modules/_shared/skill-rules.js';

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

  it('an extracted skill (ADR 0016) reaches the prompt through the hash gate; a tampered one does not', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr, agent } = await setupPr(app);

    // Stored exactly as the conventions module stores it: auto-vetted with sha256(body).
    const insertExtracted = async (name: string, body: string, tamper: boolean) => {
      const policy = applySourcePolicy('extracted', body, true);
      const [row] = await pg.handle.db
        .insert(t.skills)
        .values({
          workspaceId,
          name,
          description: '',
          type: 'convention',
          source: 'extracted',
          body: tamper ? `${body} (edited behind the vet)` : body,
          enabled: policy.enabled,
          needsVetting: policy.needsVetting,
          vettedBodyHash: policy.vettedBodyHash,
          evidenceFiles: ['src/config.ts'],
        })
        .returning();
      return row!;
    };
    const vetted = await insertExtracted(`extracted-ok-${Date.now()}`, 'Throw NotFoundError for missing rows.', false);
    const tampered = await insertExtracted(`extracted-tampered-${Date.now()}`, 'Never log secrets.', true);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: {
        links: [
          { skill_id: vetted.id, enabled: true },
          { skill_id: tampered.id, enabled: true },
        ],
      },
    });

    const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = started.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const used = trace.prompt_assembly.skills_used as { id: string }[];
    expect(used.map((s) => s.id)).toEqual([vetted.id]);
    expect(String(trace.prompt_assembly.skills)).toContain('Throw NotFoundError for missing rows.');
    expect(String(trace.prompt_assembly.skills)).not.toContain(tampered.name);
    await app.close();
  });

  // Invariant every reader relies on (UI trace drawer, waitForPrRuns callers):
  // once agent_runs.status is terminal, GET /runs/:id/trace already resolves.
  // A trigger snapshots "does the trace row exist?" at the exact moment the
  // status flips, so the check is deterministic, not timing-dependent.
  it('the trace is persisted BEFORE the run turns terminal (done and failed paths)', async () => {
    const { sql } = pg.handle;
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS test_terminal_probe (run_id uuid, status text, trace_present boolean);
      CREATE OR REPLACE FUNCTION test_terminal_probe_fn() RETURNS trigger AS $$
      BEGIN
        INSERT INTO test_terminal_probe
          VALUES (NEW.id, NEW.status, EXISTS (SELECT 1 FROM run_traces WHERE run_id = NEW.id));
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS test_terminal_probe_trg ON agent_runs;
      CREATE TRIGGER test_terminal_probe_trg AFTER UPDATE OF status ON agent_runs
        FOR EACH ROW WHEN (NEW.status IN ('done', 'failed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION test_terminal_probe_fn();
    `);
    try {
      const runOnce = async (structured: unknown) => {
        const app = await appWith(structured);
        const { pr, agent } = await setupPr(app);
        const started = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
        const runId = started.json().runs[0].run_id as string;
        const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
        await app.close();
        return { runId, status: run?.status };
      };
      const done = await runOnce(REVIEW_FIXTURE);
      // A fixture that fails the Review schema makes the mock LLM throw → failure path.
      const failed = await runOnce({ not: 'a review' });
      expect(done.status).toBe('done');
      expect(failed.status).toBe('failed');

      const probes = await sql<{ run_id: string; status: string; trace_present: boolean }[]>`
        SELECT run_id, status, trace_present FROM test_terminal_probe
        WHERE run_id IN (${done.runId}, ${failed.runId}) ORDER BY status`;
      expect(probes.map((p) => [p.run_id, p.status, p.trace_present])).toEqual([
        [done.runId, 'done', true],
        [failed.runId, 'failed', true],
      ]);
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS test_terminal_probe_trg ON agent_runs;`);
    }
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
    const beforeTrace = (
      await app.inject({ method: 'GET', url: `/runs/${before.json().runs[0].run_id}/trace` })
    ).json();
    expect(beforeTrace.prompt_assembly.skills_used ?? null).toBeNull();

    await app.inject({ method: 'POST', url: `/skills/${imported.id}/vet`, payload: { version: imported.version } });
    await app.inject({ method: 'PUT', url: `/skills/${imported.id}`, payload: { enabled: true } });

    const after = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    const afterTrace = (
      await app.inject({ method: 'GET', url: `/runs/${after.json().runs[0].run_id}/trace` })
    ).json();
    expect(afterTrace.prompt_assembly.skills_used?.[0]?.id).toBe(imported.id);
    await app.close();
  });
});
