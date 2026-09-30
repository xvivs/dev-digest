/**
 * Plan Phase 3 migrations 0019 (custom backfill) + 0020 (FK + CHECK).
 *
 * Testcontainers applies every migration to an empty DB, so the DML in 0019
 * never sees a row there. This test rewinds 0020 (drops its constraints),
 * inserts the legacy shapes 0019 must repair, replays 0019 twice (idempotence)
 * and then 0020, and asserts the result.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const statements = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../src/db/migrations/${file}`, import.meta.url)), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

d('eval migrations 0019/0020 (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('deletes orphan skill cases, backfills skill_id, labels legacy costs, then the FK + CHECK hold', async () => {
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    const [other] = await db.insert(t.workspaces).values({ name: `other-${Date.now()}` }).returning();
    const [skill] = await db
      .insert(t.skills)
      .values({ workspaceId: ws!.id, name: `mig-skill-${Date.now()}`, description: '', type: 'rubric', source: 'manual', body: 'b' })
      .returning();

    // Rewind 0020 so the legacy shapes can exist.
    await db.execute(sql.raw('ALTER TABLE "eval_cases" DROP CONSTRAINT "eval_cases_skill_id_skills_id_fk"'));
    await db.execute(sql.raw('DROP INDEX "eval_cases_skill_id_idx"'));
    await db.execute(sql.raw('ALTER TABLE "eval_cases" DROP CONSTRAINT "eval_cases_skill_owner_check"'));
    await db.execute(sql.raw('ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_cost_pair_check"'));

    const legacy = (ownerKind: 'skill' | 'agent', ownerId: string, workspaceId = ws!.id) => ({
      workspaceId,
      ownerKind,
      ownerId,
      name: `legacy-${ownerKind}-${ownerId.slice(0, 4)}-${Math.random()}`,
      inputDiff: '',
      expectedOutput: { anything: 'goes' },
    });
    const [kept] = await db.insert(t.evalCases).values(legacy('skill', skill!.id)).returning();
    const [orphan] = await db.insert(t.evalCases).values(legacy('skill', crypto.randomUUID())).returning();
    // Owner exists, but in ANOTHER workspace: an orphan too (no cross-tenant link).
    const [foreign] = await db.insert(t.evalCases).values(legacy('skill', skill!.id, other!.id)).returning();
    const [agentCase] = await db.insert(t.evalCases).values(legacy('agent', crypto.randomUUID())).returning();
    const [legacyRun] = await db.insert(t.evalRuns).values({ caseId: kept!.id, costUsd: 0.12 }).returning();

    for (let i = 0; i < 2; i++) {
      for (const stmt of statements('0019_eval_cases_skill_backfill.sql')) await db.execute(sql.raw(stmt));
    }
    for (const stmt of statements('0020_eval_cases_skill_fk.sql')) await db.execute(sql.raw(stmt));

    const ids = (await db.select({ id: t.evalCases.id }).from(t.evalCases)).map((r) => r.id);
    expect(ids).toContain(kept!.id);
    expect(ids).toContain(agentCase!.id);
    expect(ids).not.toContain(orphan!.id);
    expect(ids).not.toContain(foreign!.id);

    const [k] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, kept!.id));
    expect(k!.skillId).toBe(skill!.id);
    const [a] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, agentCase!.id));
    expect(a!.skillId).toBeNull();

    const [r] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.id, legacyRun!.id));
    expect(r!.costSource).toBe('estimated');

    // The CHECK now refuses a skill case without skill_id, and the FK cascades.
    await expect(
      db.insert(t.evalCases).values({ ...legacy('skill', skill!.id), skillId: null }),
    ).rejects.toThrow();
    await expect(db.insert(t.evalRuns).values({ caseId: kept!.id, costUsd: 0.1 })).rejects.toThrow();
    await db.delete(t.skills).where(eq(t.skills.id, skill!.id));
    const after = await db.select().from(t.evalCases).where(eq(t.evalCases.id, kept!.id));
    expect(after).toHaveLength(0);
  });
});
