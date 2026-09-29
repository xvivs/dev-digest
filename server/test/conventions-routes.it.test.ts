/**
 * Conventions extractor end to end over a real Postgres (Testcontainers):
 * buildApp + inject, the real repository, JobRunner, Repo Intel facade and
 * the migrations. The clone is a tmp dir on disk (the safe-path guard and the
 * AC-3 disk check need real files); git HEAD and the LLM are mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LLMProvider, RepoRef, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { sha256Hex } from '../src/modules/_shared/hash.js';
import { ScanRunningError } from '../src/modules/conventions/domain.js';
import { ConventionsRepository } from '../src/modules/conventions/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** MockGitClient over a real directory: the guard and the reads hit the disk. */
class DiskGit extends MockGitClient {
  head = 'c0ffee1234';
  constructor(private readonly root: string) {
    super();
  }
  override clonePathFor(repo: RepoRef): string {
    return path.join(this.root, repo.owner, repo.name);
  }
  override async readFile(repo: RepoRef, rel: string): Promise<string> {
    return readFile(path.join(this.clonePathFor(repo), rel), 'utf8');
  }
  override async currentHead(): Promise<string> {
    return this.head;
  }
}

/** Holds every structured call until `open()`, so a scan stays `running` on demand. */
class GatedLLM extends MockLLMProvider {
  private release!: () => void;
  private readonly gate = new Promise<void>((r) => (this.release = r));
  open(): void {
    this.release();
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await this.gate;
    return super.completeStructured(req);
  }
}

const FILES: Record<string, string> = {
  'src/a.ts': [
    'export async function loadUser(id: string) {',
    '  const row = await db.select().from(users);',
    "  if (!row) throw new NotFoundError('User not found');",
    '  return row;',
    '}',
  ].join('\n'),
  'src/lib/b.ts': ['export function loadTeam() {', "  throw new NotFoundError('Team not found');", '}'].join('\n'),
  'package.json': '{ "name": "demo" }',
};

const GOOD = {
  rule: 'Throw NotFoundError when a lookup finds nothing',
  evidence: [
    { path: 'src/a.ts', quote: "if (!row) throw new NotFoundError('User not found');", line_hint: 3 },
    { path: 'src/lib/b.ts', quote: "throw new NotFoundError('Team not found');", line_hint: 2 },
  ],
  counter_example: null,
  origin: 'code',
  signal_id: null,
  prior_ref: null,
  category: 'error-handling',
  llm_confidence: 0.9,
};
const HALLUCINATED = {
  ...GOOD,
  rule: 'Wrap every handler in a retry helper',
  evidence: [{ path: 'src/a.ts', quote: 'return withRetry(() => handler(req));', line_hint: 9 }],
};

d('conventions routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let cloneRoot: string;
  let git: DiskGit;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws?.id ?? (await pg.handle.db.select().from(t.workspaces))[0]!.id;
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'conventions-other' }).returning();
    otherWorkspaceId = other!.id;
    cloneRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'conv-it-')));
    git = new DiskGit(cloneRoot);
  });
  afterAll(async () => {
    await pg?.stop();
    if (cloneRoot) await rm(cloneRoot, { recursive: true, force: true });
  });

  const llmFor = (candidates: unknown[]) =>
    new MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: { candidates } } });

  function makeApp(candidates: unknown[] = [GOOD, HALLUCINATED], llm: LLMProvider = llmFor(candidates)) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { git, llm: { openrouter: llm } } });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  let repoSeq = 0;
  /** A cloned + indexed repo: files on disk, index state `full`, ranked paths. */
  async function makeRepo(opts: { ws?: string; files?: Record<string, string>; indexed?: boolean; ranked?: boolean; onDisk?: boolean } = {}) {
    repoSeq += 1;
    const name = `conv-${repoSeq}-${Date.now()}`;
    const ws = opts.ws ?? workspaceId;
    const dir = path.join(cloneRoot, 'acme', name);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath: dir })
      .returning();
    if (opts.onDisk !== false) {
      for (const [rel, content] of Object.entries(opts.files ?? FILES)) {
        await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await writeFile(path.join(dir, rel), content);
      }
    }
    if (opts.indexed !== false) {
      await pg.handle.db
        .insert(t.repoIndexState)
        .values({ repoId: repo!.id, lastIndexedSha: git.head, indexerVersion: 1, status: 'full' });
    }
    if (opts.ranked !== false) {
      const code = Object.keys(opts.files ?? FILES).filter((p) => p.endsWith('.ts'));
      if (code.length > 0) {
        await pg.handle.db.insert(t.fileRank).values(
          code.map((filePath, i) => ({ repoId: repo!.id, filePath, pagerank: 1 - i / 10, hotness: 0, rank: 1 - i / 10, percentile: 90 })),
        );
      }
    }
    return repo!;
  }

  async function waitForScan(app: App, repoId: string) {
    await app.container.jobs.onIdle();
    for (let i = 0; i < 100; i += 1) {
      const page = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
      if (!page.running_scan) return page;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('scan did not finish');
  }

  async function createAgent(app: App) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `conv-agent-${Date.now()}-${Math.random()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json() as { id: string };
  }

  async function acceptedConvention(app: App) {
    const repo = await makeRepo();
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBe(202);
    const page = await waitForScan(app, repo.id);
    const id = page.candidates[0].id as string;
    await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { status: 'accepted' } });
    return { repo, id };
  }

  it('extract → GET → PATCH accept → create skill with an agent → second scan keeps ids, decisions, skills', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const started = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(started.statusCode).toBe(202);
    const scanId = started.json().scan_id as string;

    const page = await waitForScan(app, repo.id);
    expect(page.last_scan).toMatchObject({
      id: scanId,
      status: 'done',
      commit_sha: git.head,
      found_count: 2,
      verified_count: 1,
      dropped_count: 1,
      sample_file_count: 3,
      model: 'deepseek/deepseek-v4-flash',
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
      cost_source: 'estimated',
      retry_count: 0,
    });
    expect(page.last_scan.duration_ms).toBeGreaterThanOrEqual(0);
    expect(page.latest_done_scan.id).toBe(scanId);
    expect(page.running_scan).toBeNull();
    expect(page.candidates).toHaveLength(1);
    const cand = page.candidates[0];
    expect(cand).toMatchObject({
      status: 'pending',
      rule: GOOD.rule,
      edited: false,
      seen_in_latest: true,
      last_seen_commit_sha: git.head,
      support_count: 2,
      skills: [],
    });
    expect(cand.evidence).toEqual([
      { path: 'src/a.ts', line_start: 3, line_end: 3, snippet: "  if (!row) throw new NotFoundError('User not found');" },
      { path: 'src/lib/b.ts', line_start: 2, line_end: 2, snippet: "  throw new NotFoundError('Team not found');" },
    ]);

    const accepted = await app.inject({ method: 'PATCH', url: `/conventions/${cand.id}`, payload: { status: 'accepted' } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: cand.id, status: 'accepted', seen_in_latest: true });

    // An agent that already links one skill: the new link lands at max(order) + 1.
    const agent = await createAgent(app);
    const existing = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: `pre-${repo.id.slice(0, 8)}`, type: 'rubric', body: 'Existing.' } })
    ).json();
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { links: [{ skill_id: existing.id, enabled: true }] } });

    const body = `# Conventions\n\n## Throw NotFoundError\nDetected in \`src/a.ts:3-3\`\n\`\`\`ts\nif (!row) throw new NotFoundError('User not found');\n\`\`\``;
    const skillName = `conv-skill-${repo.id.slice(0, 8)}`;
    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name: skillName, body, enabled: true, convention_ids: [cand.id], agent_ids: [agent.id] },
    });
    expect(created.statusCode).toBe(201);
    const { skill, linked_agent_ids } = created.json();
    expect(linked_agent_ids).toEqual([agent.id]);
    expect(skill).toMatchObject({
      name: skillName,
      type: 'convention',
      source: 'extracted',
      enabled: true,
      needs_vetting: false,
      evidence_files: ['src/a.ts', 'src/lib/b.ts'],
    });
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row!.vettedBodyHash).toBe(sha256Hex(body));
    const links = await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.agentId, agent.id));
    expect(links.find((l) => l.skillId === skill.id)).toMatchObject({ order: 1, enabled: true });

    // AC-29: a second skill from the same convention is independent; the card lists both.
    const second = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name: `${skillName}-2`, body: 'Same rule, other skill.', enabled: false, convention_ids: [cand.id], agent_ids: [] },
    });
    expect(second.statusCode).toBe(201);
    // AC-30: editing an extracted skill's body resets its vet.
    const edited = await app.inject({ method: 'PUT', url: `/skills/${second.json().skill.id}`, payload: { body: 'Edited body.' } });
    expect(edited.json()).toMatchObject({ source: 'extracted', needs_vetting: true });
    const [editedRow] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, second.json().skill.id));
    expect(editedRow!.vettedBodyHash).toBeNull();

    // Second scan: the model rewords the rule but cites the prior id; a new rule appears too.
    const app2 = await makeApp([
      { ...GOOD, rule: 'Raise NotFoundError on an empty lookup result', prior_ref: 'P1' },
      {
        ...GOOD,
        rule: 'Declare exported functions with the function keyword',
        evidence: [
          { path: 'src/a.ts', quote: 'export async function loadUser(id: string) {', line_hint: 1 },
          { path: 'src/lib/b.ts', quote: 'export function loadTeam() {', line_hint: 1 },
        ],
        category: 'structure',
      },
    ]);
    const again = await app2.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(again.statusCode).toBe(202);
    const page2 = await waitForScan(app2, repo.id);
    expect(page2.last_scan).toMatchObject({ status: 'done', matched_prior_count: 1 });
    expect(page2.candidates).toHaveLength(2);
    const kept = page2.candidates.find((c: { id: string }) => c.id === cand.id);
    expect(kept).toMatchObject({ status: 'accepted', rule: GOOD.rule, seen_in_latest: true });
    expect(kept.skills.map((s: { name: string }) => s.name).sort()).toEqual([skillName, `${skillName}-2`].sort());
    // AC-4 order: pending before accepted.
    expect(page2.candidates.map((c: { status: string }) => c.status)).toEqual(['pending', 'accepted']);
    await app.close();
    await app2.close();
  });

  it('a failed scan (empty sample) is visible in GET with its error', async () => {
    const app = await makeApp();
    const repo = await makeRepo({ ranked: false, files: { 'README.md': '# nothing to rank' } });
    expect((await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` })).statusCode).toBe(202);
    const page = await waitForScan(app, repo.id);
    expect(page.last_scan.status).toBe('failed');
    expect(page.last_scan.error).toMatch(/^empty_sample/);
    expect(page.latest_done_scan).toBeNull();
    expect(page.candidates).toEqual([]);
    await app.close();
  });

  it('a running scan → 409 scan_running with its id; the unique index maps 23505 to the same error', async () => {
    const app = await makeApp();
    const repo = await makeRepo();
    const [running] = await pg.handle.db
      .insert(t.conventionScans)
      .values({ workspaceId, repoId: repo.id, status: 'running' })
      .returning();
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'scan_running', details: { scan_id: running!.id } });

    // Race path: skip the pre-check and hit the partial unique index directly.
    const store = new ConventionsRepository(pg.handle.db, {
      skillsOn: (tx) => app.container.skillsRepoOn(tx),
      agentsOn: (tx) => app.container.agentsRepoOn(tx),
    });
    const err = await store.insertRunningScan(workspaceId, repo.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScanRunningError);
    expect((err as ScanRunningError).details).toEqual({ scan_id: running!.id });
    await app.close();
  });

  it('parallel extracts: exactly one scan starts', async () => {
    const llm = new GatedLLM('openai', { structuredBySchema: { ConventionExtraction: { candidates: [GOOD] } } });
    const app = await makeApp([GOOD], llm);
    const repo = await makeRepo();
    const results = await Promise.all(
      [0, 1, 2].map(() => app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` })),
    );
    llm.open();
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 202)).toHaveLength(1);
    for (const r of results.filter((x) => x.statusCode !== 202)) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error.code).toBe('scan_running');
    }
    await waitForScan(app, repo.id);
    await app.close();
  });

  it('409 repo_not_cloned when the clone dir is gone; 409 repo_not_indexed without an index', async () => {
    const app = await makeApp();
    const gone = await makeRepo({ onDisk: false });
    const r1 = await app.inject({ method: 'POST', url: `/repos/${gone.id}/conventions/extract` });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error.code).toBe('repo_not_cloned');

    const unindexed = await makeRepo({ indexed: false });
    const r2 = await app.inject({ method: 'POST', url: `/repos/${unindexed.id}/conventions/extract` });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe('repo_not_indexed');
    await app.close();
  });

  it('budget over 24 KB → 422 with agent_id and the skill, links and convention_skills rolled back', async () => {
    const app = await makeApp();
    const { repo, id } = await acceptedConvention(app);
    const agent = await createAgent(app);
    const big = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: `big-${repo.id.slice(0, 8)}`, type: 'rubric', body: 'x'.repeat(24_500) } })
    ).json();
    expect(
      (await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { links: [{ skill_id: big.id, enabled: true }] } })).statusCode,
    ).toBe(200);

    const name = `over-budget-${repo.id.slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name, body: 'y'.repeat(200), enabled: true, convention_ids: [id], agent_ids: [agent.id] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'agent_skills_budget_exceeded', details: { agent_id: agent.id } });
    expect(await pg.handle.db.select().from(t.skills).where(eq(t.skills.name, name))).toHaveLength(0);
    expect(await pg.handle.db.select().from(t.conventionSkills).where(eq(t.conventionSkills.conventionId, id))).toHaveLength(0);
    expect(await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.agentId, agent.id))).toHaveLength(1);

    // A disabled skill does not count toward the budget.
    const ok = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name, body: 'y'.repeat(200), enabled: false, convention_ids: [id], agent_ids: [agent.id] },
    });
    expect(ok.statusCode).toBe(201);
    await app.close();
  });

  it('a taken skill name → 409 skill_name_taken, nothing linked', async () => {
    const app = await makeApp();
    const { repo, id } = await acceptedConvention(app);
    const name = `taken-${repo.id.slice(0, 8)}`;
    await app.inject({ method: 'POST', url: '/skills', payload: { name, type: 'rubric', body: 'Existing.' } });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name, body: 'Body.', enabled: true, convention_ids: [id], agent_ids: [] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('skill_name_taken');
    expect(await pg.handle.db.select().from(t.conventionSkills).where(eq(t.conventionSkills.conventionId, id))).toHaveLength(0);
    await app.close();
  });

  it('a pending or rejected convention → 422 convention_not_accepted', async () => {
    const app = await makeApp();
    const repo = await makeRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const page = await waitForScan(app, repo.id);
    const id = page.candidates[0].id;
    const pending = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name: `pending-${repo.id.slice(0, 8)}`, body: 'B.', enabled: true, convention_ids: [id], agent_ids: [] },
    });
    expect(pending.statusCode).toBe(422);
    expect(pending.json().error.code).toBe('convention_not_accepted');

    await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { status: 'rejected' } });
    const rejected = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skills`,
      payload: { name: `rejected-${repo.id.slice(0, 8)}`, body: 'B.', enabled: true, convention_ids: [id], agent_ids: [] },
    });
    expect(rejected.statusCode).toBe(422);
    await app.close();
  });

  it('ids from another workspace or repo → 404', async () => {
    const app = await makeApp();
    const { repo, id } = await acceptedConvention(app);
    const otherRepo = await makeRepo();
    const foreignRepo = await makeRepo({ ws: otherWorkspaceId });
    const [foreignConv] = await pg.handle.db
      .insert(t.conventions)
      .values({
        workspaceId: otherWorkspaceId,
        repoId: foreignRepo.id,
        fingerprint: 'foreign',
        category: 'naming',
        origin: 'code',
        rule: 'Foreign workspace rule',
        originalRule: 'Foreign workspace rule',
        status: 'accepted',
      })
      .returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: otherWorkspaceId, name: 'foreign-agent', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x', version: 1 })
      .returning();

    expect((await app.inject({ method: 'GET', url: `/repos/${foreignRepo.id}/conventions` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/repos/${foreignRepo.id}/conventions/extract` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url: `/conventions/${foreignConv!.id}`, payload: { status: 'rejected' } })).statusCode,
    ).toBe(404);

    const post = (repoId: string, conventionIds: string[], agentIds: string[]) =>
      app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skills`,
        payload: { name: `x-${Math.random().toString(36).slice(2, 10)}`, body: 'B.', enabled: true, convention_ids: conventionIds, agent_ids: agentIds },
      });
    expect((await post(otherRepo.id, [id], [])).statusCode).toBe(404); // convention of another repo
    expect((await post(repo.id, [foreignConv!.id], [])).statusCode).toBe(404); // another workspace
    expect((await post(repo.id, [id], [foreignAgent!.id])).statusCode).toBe(404); // foreign agent
    expect((await post(foreignRepo.id, [foreignConv!.id], [])).statusCode).toBe(404); // foreign repo
    const [still] = await pg.handle.db.select().from(t.conventions).where(eq(t.conventions.id, foreignConv!.id));
    expect(still!.status).toBe('accepted');
    await app.close();
  });

  it('PATCH edits rule and category (edited, fingerprint unchanged) and rejects bad input with 422', async () => {
    const app = await makeApp();
    const repo = await makeRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const page = await waitForScan(app, repo.id);
    const id = page.candidates[0].id;
    const [before] = await pg.handle.db.select().from(t.conventions).where(eq(t.conventions.id, id));

    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { rule: '  Throw NotFoundError for a missing row  ', category: 'api' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rule: 'Throw NotFoundError for a missing row', original_rule: GOOD.rule, category: 'api', edited: true });
    const [after] = await pg.handle.db.select().from(t.conventions).where(eq(t.conventions.id, id));
    expect(after!.fingerprint).toBe(before!.fingerprint);
    expect(after!.editedAt).not.toBeNull();

    for (const payload of [{ rule: 'Hidden​character rule' }, { rule: '         ' }, {}, { status: 'accepted', extra: 1 }]) {
      expect((await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload })).statusCode).toBe(422);
    }
    await app.close();
  });

  it('retention keeps the 10 newest scans plus referenced ones (AC-22)', async () => {
    const app = await makeApp();
    const repo = await makeRepo();
    const old = await pg.handle.db
      .insert(t.conventionScans)
      .values(
        Array.from({ length: 12 }, (_, i) => ({
          workspaceId,
          repoId: repo.id,
          status: 'done' as const,
          startedAt: new Date(Date.UTC(2020, 0, 1 + i)),
        })),
      )
      .returning();
    const oldest = old.find((s) => s.startedAt.getTime() === Date.UTC(2020, 0, 1))!;
    await pg.handle.db.insert(t.conventions).values({
      workspaceId,
      repoId: repo.id,
      fingerprint: 'kept-by-reference',
      category: 'naming',
      origin: 'code',
      rule: 'Referenced by an old scan',
      originalRule: 'Referenced by an old scan',
      status: 'accepted',
      lastSeenScanId: oldest.id,
    });

    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    await waitForScan(app, repo.id);
    const left = await pg.handle.db.select().from(t.conventionScans).where(eq(t.conventionScans.repoId, repo.id));
    expect(left).toHaveLength(11);
    expect(left.some((s) => s.id === oldest.id)).toBe(true);
    await app.close();
  });

  it('boot reaps scans left running by a dead process (AC-18)', async () => {
    const repo = await makeRepo();
    const [orphan] = await pg.handle.db
      .insert(t.conventionScans)
      .values({ workspaceId, repoId: repo.id, status: 'running' })
      .returning();
    const app = await makeApp();
    const [row] = await pg.handle.db
      .select()
      .from(t.conventionScans)
      .where(and(eq(t.conventionScans.id, orphan!.id), eq(t.conventionScans.repoId, repo.id)));
    expect(row).toMatchObject({ status: 'failed' });
    expect(row!.error).toMatch(/interrupted/);
    await app.close();
  });
});
