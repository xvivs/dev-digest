/**
 * BriefRepository over a real Postgres (Testcontainers): the round-trip, the
 * schedule-candidate query, the automatic_brief settings read, cascade, and the
 * DB CHECK that keeps `cost_usd` / `cost_source` a pair (migration 0026).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { BriefRepository, readAutomaticBriefSetting } from '../src/modules/brief/repository.js';
import type { IntentWrite, RisksWrite } from '../src/modules/brief/ports.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const intentWrite = (headSha: string, over: Partial<IntentWrite> = {}): IntentWrite => ({
  headSha,
  intent: 'Adds rate limiting.',
  inScope: ['limiter'],
  outOfScope: ['auth'],
  confidence: 'medium',
  sources: [{ kind: 'title', ref: null, chars: 10 }],
  unresolvedLinks: [{ url: 'https://example.com/x', reason: 'external_host' }],
  provider: 'openrouter',
  model: 'm1',
  tokensIn: 100,
  tokensOut: 20,
  costUsd: 0.002,
  costSource: 'provider',
  ...over,
});

const risksWrite = (headSha: string, over: Partial<RisksWrite> = {}): RisksWrite => ({
  headSha,
  risks: [{ kind: 'deps', title: 'Deps', explanation: 'x', severity: 'low', file_refs: ['package.json'], origin: 'rule' }],
  droppedRefs: 2,
  ruleOnly: false,
  provider: 'openrouter',
  model: 'm2',
  tokensIn: 10,
  tokensOut: 5,
  costUsd: 0.001,
  costSource: 'estimated',
  ...over,
});

/** Flatten a driver/ORM error chain into one searchable string. */
function errText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const o = e as { message?: string; constraint?: string; constraint_name?: string; cause?: unknown };
    parts.push(o.message ?? '', o.constraint ?? '', o.constraint_name ?? '');
    e = o.cause;
  }
  return parts.join(' | ');
}

d('BriefRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repo: BriefRepository;
  let wsA: string;
  let wsB: string;
  let repoA1: string;
  let repoA2: string;
  let repoB1: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    repo = new BriefRepository(pg.handle.db);
    const db = pg.handle.db;
    const [a, b] = await db.insert(t.workspaces).values([{ name: 'A' }, { name: 'B' }]).returning();
    wsA = a!.id;
    wsB = b!.id;
    const mk = async (workspaceId: string, name: string) =>
      (await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning())[0]!.id;
    repoA1 = await mk(wsA, 'a1');
    repoA2 = await mk(wsA, 'a2');
    repoB1 = await mk(wsB, 'b1');
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function pr(
    workspaceId: string,
    repoId: string,
    over: Partial<typeof t.pullRequests.$inferInsert> = {},
  ): Promise<string> {
    const n = ++seq;
    const [row] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: n,
        title: `PR ${n}`,
        author: 'sam',
        branch: 'feat',
        base: 'main',
        headSha: 'h1',
        status: 'open',
        ...over,
      })
      .returning();
    return row!.id;
  }

  describe('round trip', () => {
    it('upsertIntent / getIntent returns the written record; a second upsert overwrites', async () => {
      const id = await pr(wsA, repoA1);
      expect(await repo.getIntent(id)).toBeUndefined();
      await repo.upsertIntent(id, intentWrite('h1'));
      expect(await repo.getIntent(id)).toMatchObject({
        pr_id: id,
        intent: 'Adds rate limiting.',
        in_scope: ['limiter'],
        out_of_scope: ['auth'],
        head_sha: 'h1',
        confidence: 'medium',
        provider: 'openrouter',
        model: 'm1',
        tokens_in: 100,
        cost_usd: 0.002,
        cost_source: 'provider',
      });
      await repo.upsertIntent(id, intentWrite('h2', { intent: 'Changed', model: 'm9' }));
      const again = await repo.getIntent(id);
      expect(again).toMatchObject({ head_sha: 'h2', intent: 'Changed', model: 'm9' });
      expect(await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, id))).toHaveLength(1);
    });

    it('upsertRisks / getRisks round-trips the JSON risks, rule_only and dropped_refs', async () => {
      const id = await pr(wsA, repoA1);
      await repo.upsertRisks(id, risksWrite('h1'));
      const got = await repo.getRisks(id);
      expect(got).toMatchObject({ head_sha: 'h1', dropped_refs: 2, rule_only: false, cost_usd: 0.001, cost_source: 'estimated' });
      expect(got!.risks[0]).toMatchObject({ kind: 'deps', origin: 'rule', file_refs: ['package.json'] });
    });

    it('null cost pair and null provider/model (a rule-only risks row) round-trip as nulls', async () => {
      const id = await pr(wsA, repoA1);
      await repo.upsertRisks(id, risksWrite('h1', { ruleOnly: true, provider: null, model: null, tokensIn: null, tokensOut: null, costUsd: null, costSource: null }));
      expect(await repo.getRisks(id)).toMatchObject({ rule_only: true, provider: null, model: null, tokens_in: null, cost_usd: null, cost_source: null });
    });

    it('a half-set pair handed to the repository is stored as a null pair, never half', async () => {
      const id = await pr(wsA, repoA1);
      await repo.upsertIntent(id, intentWrite('h1', { costUsd: 0.5, costSource: null }));
      expect(await repo.getIntent(id)).toMatchObject({ cost_usd: null, cost_source: null });
      await repo.upsertIntent(id, intentWrite('h1', { costUsd: null, costSource: 'provider' }));
      expect(await repo.getIntent(id)).toMatchObject({ cost_usd: null, cost_source: null });
      await repo.upsertRisks(id, risksWrite('h1', { costUsd: 0.5, costSource: null }));
      expect(await repo.getRisks(id)).toMatchObject({ cost_usd: null, cost_source: null });
    });

    it('an unknown provider string is read back as null rather than leaking an invalid value', async () => {
      const id = await pr(wsA, repoA1);
      await repo.upsertIntent(id, intentWrite('h1', { provider: 'mystery' }));
      expect((await repo.getIntent(id))!.provider).toBeNull();
    });
  });

  describe('DB CHECK: cost_usd / cost_source are a pair', () => {
    const base = { intent: 'i', headSha: 'h1' };

    it.each([
      ['pr_intent cost without source', () => ({ t: 'intent' as const, costUsd: 0.5, costSource: null })],
      ['pr_intent source without cost', () => ({ t: 'intent' as const, costUsd: null, costSource: 'provider' as const })],
      ['pr_risks cost without source', () => ({ t: 'risks' as const, costUsd: 0.5, costSource: null })],
      ['pr_risks source without cost', () => ({ t: 'risks' as const, costUsd: null, costSource: 'estimated' as const })],
    ])('rejects a raw insert: %s', async (_name, make) => {
      const c = make();
      const id = await pr(wsA, repoA1);
      const run =
        c.t === 'intent'
          ? pg.handle.db.insert(t.prIntent).values({ prId: id, ...base, costUsd: c.costUsd, costSource: c.costSource })
          : pg.handle.db.insert(t.prRisks).values({ prId: id, headSha: 'h1', risks: [], costUsd: c.costUsd, costSource: c.costSource });
      const err = await run.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, 'insert should have been rejected').toBeDefined();
      expect(errText(err)).toMatch(c.t === 'intent' ? /pr_intent_cost_pair_check/ : /pr_risks_cost_pair_check/);
    });

    it('accepts both null and both set on a raw insert', async () => {
      const a = await pr(wsA, repoA1);
      const b = await pr(wsA, repoA1);
      await pg.handle.db.insert(t.prIntent).values({ prId: a, ...base, costUsd: null, costSource: null });
      await pg.handle.db.insert(t.prIntent).values({ prId: b, ...base, costUsd: 0.1, costSource: 'provider' });
      expect(await repo.getIntent(a)).toMatchObject({ cost_usd: null });
      expect(await repo.getIntent(b)).toMatchObject({ cost_usd: 0.1 });
    });

    it('rejects an UPDATE that would leave a half-set pair', async () => {
      const id = await pr(wsA, repoA1);
      await repo.upsertIntent(id, intentWrite('h1'));
      const err = await pg.handle.db
        .update(t.prIntent)
        .set({ costSource: null })
        .where(eq(t.prIntent.prId, id))
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(errText(err)).toMatch(/pr_intent_cost_pair_check/);
    });
  });

  describe('listScheduleCandidates', () => {
    it('scopes to workspace + repo, open PRs lacking a row for the CURRENT head, newest updated_at first, no LIMIT', async () => {
      const db = pg.handle.db;
      const [scopeWs] = await db.insert(t.workspaces).values({ name: 'scope' }).returning();
      const [scopeRepo] = await db
        .insert(t.repos)
        .values({ workspaceId: scopeWs!.id, owner: 'acme', name: 'scope', fullName: 'acme/scope' })
        .returning();
      const ws = scopeWs!.id;
      const rid = scopeRepo!.id;
      const [otherRepo] = await db
        .insert(t.repos)
        .values({ workspaceId: ws, owner: 'acme', name: 'scope2', fullName: 'acme/scope2' })
        .returning();

      const day = (n: number) => new Date(Date.UTC(2026, 0, n));
      const none = await pr(ws, rid, { updatedAt: day(1) }); // no rows
      const intentOnly = await pr(ws, rid, { updatedAt: day(5) }); // intent present, risks missing
      const risksOnly = await pr(ws, rid, { updatedAt: day(3) }); // risks present, intent missing
      const both = await pr(ws, rid, { updatedAt: day(9) }); // fresh: excluded
      const staleBoth = await pr(ws, rid, { updatedAt: day(2), headSha: 'h2' }); // rows exist for h1 only
      const merged = await pr(ws, rid, { status: 'merged', updatedAt: day(8) });
      const closed = await pr(ws, rid, { status: 'closed', updatedAt: day(8) });
      const noUpdated = await pr(ws, rid, { updatedAt: null }); // nulls last
      const foreignRepo = await pr(ws, otherRepo!.id, { updatedAt: day(7) });
      const foreignWs = await pr(wsB, repoB1, { updatedAt: day(7) });

      await repo.upsertIntent(intentOnly, intentWrite('h1'));
      await repo.upsertRisks(risksOnly, risksWrite('h1'));
      await repo.upsertIntent(both, intentWrite('h1'));
      await repo.upsertRisks(both, risksWrite('h1'));
      await repo.upsertIntent(staleBoth, intentWrite('h1'));
      await repo.upsertRisks(staleBoth, risksWrite('h1'));

      const out = await repo.listScheduleCandidates(ws, rid);
      expect(out.map((c) => c.prId)).toEqual([intentOnly, risksOnly, staleBoth, none, noUpdated]);
      expect(out.find((c) => c.prId === intentOnly)).toMatchObject({ hasIntent: true, hasRisks: false, headSha: 'h1' });
      expect(out.find((c) => c.prId === risksOnly)).toMatchObject({ hasIntent: false, hasRisks: true });
      expect(out.find((c) => c.prId === staleBoth)).toMatchObject({ headSha: 'h2', hasIntent: false, hasRisks: false });
      const ids = out.map((c) => c.prId);
      for (const excluded of [both, merged, closed, foreignRepo, foreignWs]) expect(ids).not.toContain(excluded);

      // A foreign workspace asking for this repo sees nothing of it.
      expect(await repo.listScheduleCandidates(wsB, rid)).toEqual([]);
    });

    it('returns every candidate: more than 10 rows are not truncated by SQL', async () => {
      const db = pg.handle.db;
      const [w] = await db.insert(t.workspaces).values({ name: 'many' }).returning();
      const [r] = await db
        .insert(t.repos)
        .values({ workspaceId: w!.id, owner: 'acme', name: 'many', fullName: 'acme/many' })
        .returning();
      for (let i = 0; i < 25; i++) await pr(w!.id, r!.id);
      expect(await repo.listScheduleCandidates(w!.id, r!.id)).toHaveLength(25);
    });
  });

  describe('readAutomaticBriefSetting', () => {
    it('is undefined with no row and returns the raw stored value, scoped per workspace', async () => {
      const db = pg.handle.db;
      const [w1] = await db.insert(t.workspaces).values({ name: 'set1' }).returning();
      const [w2] = await db.insert(t.workspaces).values({ name: 'set2' }).returning();
      expect(await readAutomaticBriefSetting(db, w1!.id)).toBeUndefined();
      await db.insert(t.settings).values({ workspaceId: w1!.id, key: 'automatic_brief', value: false });
      expect(await readAutomaticBriefSetting(db, w1!.id)).toBe(false);
      expect(await readAutomaticBriefSetting(db, w2!.id)).toBeUndefined();
    });
  });

  it('cascade: deleting the PR removes its intent and risks rows', async () => {
    const id = await pr(wsA, repoA2);
    await repo.upsertIntent(id, intentWrite('h1'));
    await repo.upsertRisks(id, risksWrite('h1'));
    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, id));
    expect(await repo.getIntent(id)).toBeUndefined();
    expect(await repo.getRisks(id)).toBeUndefined();
  });
});
