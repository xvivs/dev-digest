/**
 * Spec 06 D6 / AC-14: `repo_index_state.last_indexed_at` is written only by
 * runs that re-read the clone at a HEAD, and kept by every other write.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository, type IndexStateUpsert } from '../src/modules/repo-intel/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('repo_index_state.last_indexed_at', () => {
  let pg: PgFixture;
  let repo: RepoIntelRepository;
  let workspaceId: string;
  let n = 0;

  async function newRepo(): Promise<string> {
    n += 1;
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `idx-${n}`, fullName: `acme/idx-${n}` })
      .returning();
    return r!.id;
  }

  function upsert(repoId: string, extra: Partial<IndexStateUpsert> = {}): IndexStateUpsert {
    return {
      repoId,
      lastIndexedSha: 'sha1',
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      stats: {},
      ...extra,
    };
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new RepoIntelRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('a row inserted without it maps to null', async () => {
    const id = await newRepo();
    await repo.upsertIndexState(upsert(id));
    expect((await repo.tryGetIndexState(id))!.lastIndexedAt).toBeNull();
  });

  it('upsert with lastIndexedAt sets it; a later upsert without it keeps it', async () => {
    const id = await newRepo();
    const at = new Date('2026-05-01T10:00:00Z');
    await repo.upsertIndexState(upsert(id, { lastIndexedAt: at }));
    expect((await repo.tryGetIndexState(id))!.lastIndexedAt).toEqual(at);

    await repo.upsertIndexState(upsert(id, { lastIndexedSha: '', status: 'degraded' }));
    const after = (await repo.tryGetIndexState(id))!;
    expect(after.status).toBe('degraded');
    expect(after.lastIndexedAt).toEqual(at);
  });

  it('advanceSha sets it; touchIndexState does not', async () => {
    const id = await newRepo();
    const at = new Date('2026-05-01T10:00:00Z');
    await repo.upsertIndexState(upsert(id, { lastIndexedAt: at }));

    await repo.touchIndexState(id);
    expect((await repo.tryGetIndexState(id))!.lastIndexedAt).toEqual(at);

    await repo.advanceSha(id, 'sha2');
    const advanced = (await repo.tryGetIndexState(id))!;
    expect(advanced.lastIndexedSha).toBe('sha2');
    expect(advanced.lastIndexedAt!.getTime()).toBeGreaterThan(at.getTime());
  });

  it('maps partialReason from stats', async () => {
    const id = await newRepo();
    await repo.upsertIndexState(upsert(id, { status: 'partial', stats: { softBudgetReached: true } }));
    expect((await repo.tryGetIndexState(id))!.partialReason).toBe('soft_budget');
    await repo.upsertIndexState(upsert(id, { status: 'partial', stats: { parseDegraded: [{ file: 'a', reason: 'x' }] } }));
    expect((await repo.tryGetIndexState(id))!.partialReason).toBe('parse_errors');
    await repo.upsertIndexState(upsert(id, { status: 'partial', stats: { reason: 'no_files' } }));
    expect((await repo.tryGetIndexState(id))!.partialReason).toBe('no_files');
    await repo.upsertIndexState(upsert(id, { status: 'partial', stats: { graphFailed: 'boom', parseDegraded: [] } }));
    expect((await repo.tryGetIndexState(id))!.partialReason).toBe('graph_failed');
    // F5: an incremental that carries a partial forward stores the prior reason.
    await repo.upsertIndexState(upsert(id, { status: 'partial', stats: { incremental: true, parseDegraded: [], partialReason: 'soft_budget' } }));
    expect((await repo.tryGetIndexState(id))!.partialReason).toBe('soft_budget');
    // An unknown carried value is ignored, not passed through.
    await repo.upsertIndexState(upsert(id, { status: 'partial', stats: { partialReason: 'bogus' } }));
    expect((await repo.tryGetIndexState(id))!.partialReason).toBeUndefined();
  });
});
