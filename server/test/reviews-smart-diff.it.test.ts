/**
 * GET /pulls/:id/smart-diff end to end over a real Postgres (Testcontainers):
 * buildApp + inject, the real ReviewRepository. github / llm overrides throw
 * and count, so AC-10 (no LLM, no GitHub call) is asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SmartDiffResponse } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let calls = 0;
/** Every method throws and bumps the counter. */
const tripwire = () =>
  new Proxy(
    {},
    {
      get: () => () => {
        calls++;
        throw new Error('must not be called while serving smart-diff');
      },
    },
  );

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'sd-it', fullName: 'acme/sd-it' })
      .returning();
    repoId = repo!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: tripwire(),
        llm: { openai: tripwire(), anthropic: tripwire(), openrouter: tripwire() },
      } as never,
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function makePr(files: string[], workspace = workspaceId, repo = repoId) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: workspace,
        repoId: repo,
        number: 7000 + ++seq,
        title: 'Smart diff PR',
        author: 'sam',
        branch: 'feat',
        base: 'main',
        headSha: 'head-1',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values(files.map((path) => ({ prId: pr!.id, path, additions: 2, deletions: 1 })));
    return pr!;
  }

  const get = (id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/smart-diff` });

  it('seeded #482: five groups, src/config.ts in core with finding line 12; dismiss removes it', async () => {
    const [pr] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
    const res = await get(pr!.id);
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    const config = body.groups[0]!.files.find((f) => f.path === 'src/config.ts');
    expect(config?.finding_lines).toContain(12);

    const [finding] = await pg.handle.db.select().from(t.findings).where(eq(t.findings.file, 'src/config.ts'));
    const dismissed = await app.inject({ method: 'POST', url: `/findings/${finding!.id}/dismiss` });
    expect(dismissed.statusCode).toBe(200);
    const after = SmartDiffResponse.parse((await get(pr!.id)).json());
    expect(after.groups[0]!.files.find((f) => f.path === 'src/config.ts')?.finding_lines).toEqual([]);
  });

  it('a PR with no reviews groups by role and has no finding lines', async () => {
    const pr = await makePr(['pnpm-lock.yaml', 'README.md', 'src/a.test.ts']);
    const body = SmartDiffResponse.parse((await get(pr.id)).json());
    const byRole = Object.fromEntries(body.groups.map((g) => [g.role, g.files.map((f) => f.path)]));
    expect(byRole).toMatchObject({
      core: [],
      tests: ['src/a.test.ts'],
      wiring: [],
      docs: ['README.md'],
      boilerplate: ['pnpm-lock.yaml'],
    });
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
    expect(body.split_suggestion.total_lines).toBe(9);
  });

  it('unknown id is 404; a PR from another workspace is 404', async () => {
    expect((await get('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-sd-ws' }).returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: other!.id, owner: 'x', name: 's', fullName: 'x/s' })
      .returning();
    const foreign = await makePr(['src/a.ts'], other!.id, otherRepo!.id);
    expect((await get(foreign.id)).statusCode).toBe(404);
  });

  it('made no LLM or GitHub call', () => {
    expect(calls).toBe(0);
  });
});
