/**
 * BlastRepository over a real Postgres (Testcontainers): the round-trip, the
 * single-row-per-PR upsert, cascade, and the enum CHECK constraints.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { BlastRepository } from '../src/modules/blast/repository.js';
import type { BlastCacheEntry } from '../src/modules/blast/ports.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

type Write = Omit<BlastCacheEntry, 'computedAt'>;

const entry = (over: Partial<Write> = {}): Write => ({
  headSha: 'h1',
  sourceSha: 's1',
  indexerVersion: 1,
  indexStatus: 'full',
  repoIntelEnabled: true,
  mappingVersion: 1,
  status: 'ok',
  reason: null,
  blast: { changed_symbols: [], downstream: [], summary: 'no impact' },
  truncated: false,
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

d('BlastRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repo: BlastRepository;
  let wsId: string;
  let repoId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    repo = new BlastRepository(pg.handle.db);
    const db = pg.handle.db;
    const [w] = await db.insert(t.workspaces).values({ name: 'A' }).returning();
    wsId = w!.id;
    const [r] = await db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name: 'a1', fullName: 'acme/a1' })
      .returning();
    repoId = r!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function pr(): Promise<string> {
    const n = ++seq;
    const [row] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId,
        number: n,
        title: `PR ${n}`,
        author: 'sam',
        branch: 'feat',
        base: 'main',
        headSha: 'h1',
        status: 'open',
      })
      .returning();
    return row!.id;
  }

  it('get on an empty table returns undefined', async () => {
    expect(await repo.get(await pr())).toBeUndefined();
  });

  it('upsert then get round-trips every field and stamps computedAt', async () => {
    const id = await pr();
    const e = entry({
      status: 'degraded',
      reason: 'index_partial',
      indexStatus: 'partial',
      truncated: true,
      blast: { changed_symbols: [], downstream: [], summary: 'partial' },
    });
    await repo.upsert(id, e);
    const got = await repo.get(id);
    expect(got).toMatchObject(e);
    expect(got?.computedAt).toBeInstanceOf(Date);
  });

  it('a repeated upsert for the same PR updates the single row (onConflictDoUpdate)', async () => {
    const id = await pr();
    await repo.upsert(id, entry({ headSha: 'h1', indexerVersion: 1 }));
    await repo.upsert(id, entry({ headSha: 'h2', sourceSha: 's2', indexerVersion: 2, reason: 'no_index', status: 'degraded' }));
    const rows = await pg.handle.db.select().from(t.prBlastCache).where(eq(t.prBlastCache.prId, id));
    expect(rows).toHaveLength(1);
    expect(await repo.get(id)).toMatchObject({ headSha: 'h2', sourceSha: 's2', indexerVersion: 2, reason: 'no_index' });
  });

  it('entries are isolated per PR', async () => {
    const a = await pr();
    const b = await pr();
    await repo.upsert(a, entry({ headSha: 'ha' }));
    expect(await repo.get(b)).toBeUndefined();
    await repo.upsert(b, entry({ headSha: 'hb' }));
    expect((await repo.get(a))?.headSha).toBe('ha');
  });

  it('cascade: deleting the PR removes its cache row', async () => {
    const id = await pr();
    await repo.upsert(id, entry());
    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, id));
    expect(await repo.get(id)).toBeUndefined();
  });

  it('upsert for an unknown PR id violates the foreign key', async () => {
    const err = await repo.upsert('00000000-0000-0000-0000-000000000000', entry()).catch((e: unknown) => e);
    expect(errText(err)).toMatch(/foreign key|pr_blast_cache_pr_id/i);
  });

  it('round-trips mapping_version, which defaults to 0 for legacy inserts', async () => {
    const id = await pr();
    await repo.upsert(id, entry({ mappingVersion: 7 }));
    expect((await repo.get(id))?.mappingVersion).toBe(7);
    const legacy = await pr();
    await pg.handle.db.execute(
      sql`insert into pr_blast_cache (pr_id, head_sha, source_sha, indexer_version, index_status, repo_intel_enabled, status, blast)
          values (${legacy}, 'h', 's', 1, 'full', true, 'ok', '{"changed_symbols":[],"downstream":[],"summary":""}'::jsonb)`,
    );
    expect((await repo.get(legacy))?.mappingVersion).toBe(0);
  });

  it.each(['index_failed', 'repo_too_large', 'no_data'] as const)('CHECK accepts the new reason %s', async (reason) => {
    const id = await pr();
    await repo.upsert(id, entry({ status: 'degraded', reason }));
    expect((await repo.get(id))?.reason).toBe(reason);
  });

  it('CHECK constraints reject values outside the enum sets', async () => {
    const id = await pr();
    const bad = (over: Record<string, unknown>) => repo.upsert(id, entry(over as Partial<Write>)).catch((e: unknown) => e);
    expect(errText(await bad({ status: 'bogus' }))).toMatch(/pr_blast_cache_status_check/);
    expect(errText(await bad({ reason: 'bogus' }))).toMatch(/pr_blast_cache_reason_check/);
    expect(errText(await bad({ indexStatus: 'bogus' }))).toMatch(/pr_blast_cache_index_status_check/);
  });
});
