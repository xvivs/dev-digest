/**
 * `run_skills` backfill from `run_traces.trace.prompt_assembly.skills_used`
 * (plan Phase 2) over real Postgres: rows for live skills, deleted skills
 * skipped, prompt_sha256 only when the version snapshot's body matches the
 * traced body hash, malformed entries ignored, resumable + idempotent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { backfillRunSkills } from '../src/db/backfill-run-skills.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

d('run_skills backfill (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function runWithTrace(skillsUsed: unknown): Promise<string> {
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, status: 'done', model: 'gpt-4.1' })
      .returning();
    await pg.handle.db.insert(t.runTraces).values({
      runId: run!.id,
      trace: { prompt_assembly: { system: '', user: '', skills_used: skillsUsed } },
    });
    return run!.id;
  }

  it('copies live skills, skips deleted ones and malformed entries, and can resume', async () => {
    const repo = new SkillsRepository(pg.handle.db);
    const body = 'Flag missing auth checks.';
    const skill = await repo.insert({
      workspaceId,
      name: `backfill-${Date.now()}`,
      description: '',
      type: 'rubric',
      source: 'manual',
      body,
      enabled: true,
      needsVetting: false,
    });
    const entry = (over: Record<string, unknown> = {}) => ({
      id: skill.id,
      name: skill.name,
      version: 1,
      sha256: sha256(body),
      tokens: 7,
      ...over,
    });

    const matched = await runWithTrace([entry(), entry({ id: randomUUID(), name: 'deleted-skill' })]);
    // v5 has no snapshot → body unknown → prompt_sha256 stays NULL.
    const lostVersion = await runWithTrace([entry({ version: 5 })]);
    // The v1 snapshot exists but hashes to something else → no prompt hash.
    const hashMismatch = await runWithTrace([entry({ sha256: 'f'.repeat(64) })]);
    const malformed = [
      await runWithTrace(null),
      await runWithTrace([entry({ id: 'not-a-uuid' }), entry({ version: 'one' })]),
    ];
    const runIds = [matched, lostVersion, hashMismatch, ...malformed];

    const logs: string[] = [];
    const first = await backfillRunSkills(pg.handle.db, { batchSize: 2, log: (m) => logs.push(m) });
    expect(first.rowsInserted).toBe(3);
    expect(first.batches).toBeGreaterThan(1);
    expect(logs.every((l) => l.includes('--after='))).toBe(true);

    const rows = await pg.handle.db.select().from(t.runSkills).where(inArray(t.runSkills.runId, runIds));
    const byRun = new Map(rows.map((r) => [r.runId, r]));
    expect(rows).toHaveLength(3);
    expect(byRun.get(matched)).toEqual({
      runId: matched,
      skillId: skill.id,
      skillVersion: 1,
      bodySha256: sha256(body),
      promptSha256: sha256(`${skill.name}\n${body}`),
      tokens: 7,
    });
    expect(byRun.get(lostVersion)).toMatchObject({ skillVersion: 5, promptSha256: null });
    expect(byRun.get(hashMismatch)).toMatchObject({ skillVersion: 1, promptSha256: null });

    // Idempotent: a full re-run inserts nothing new.
    const again = await backfillRunSkills(pg.handle.db, { batchSize: 2 });
    expect(again.rowsInserted).toBe(0);

    // Resumable: starting after the last cursor scans nothing.
    const resumed = await backfillRunSkills(pg.handle.db, { after: first.lastRunId });
    expect(resumed).toMatchObject({ batches: 0, tracesScanned: 0, rowsInserted: 0 });

    // A trace written after the cursor is picked up by a resumed run.
    const later = await runWithTrace([entry()]);
    const tail = await backfillRunSkills(pg.handle.db, { after: first.lastRunId });
    const laterIsAfterCursor = later > (first.lastRunId ?? '');
    expect(tail.rowsInserted).toBe(laterIsAfterCursor ? 1 : 0);
    if (!laterIsAfterCursor) {
      // uuids are random: a new run can sort before the cursor, and only a
      // full re-run (still idempotent) reaches it.
      expect((await backfillRunSkills(pg.handle.db)).rowsInserted).toBe(1);
    }
  });
});
