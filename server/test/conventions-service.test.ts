/**
 * Hermetic service tests: every port is an in-memory fake (no Postgres, no
 * Fastify, no disk). The LLM is `MockLLMProvider` with
 * `structuredBySchema['ConventionExtraction']`, or a hanging fake for the
 * deadline case.
 */
import { describe, it, expect } from 'vitest';
import type {
  CompletionResult,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { UnsafePathError } from '../src/modules/_shared/safe-path.js';
import {
  ScanRunningError,
  RepoNotClonedError,
  RepoNotIndexedError,
  ScanTransientError,
  type ConventionEvidence,
  type ConventionRecord,
  type ConventionsPageData,
  type ConventionView,
  type ConventionWrite,
  type CreatedSkill,
  type MergedObservation,
  type PriorIdentity,
  type RepoInfo,
  type ScanRecord,
} from '../src/modules/conventions/domain.js';
import type {
  AgentLinkState,
  ConventionStore,
  ConventionsDeps,
  NewExtractedSkill,
  ScanCompletion,
} from '../src/modules/conventions/ports.js';
import { ConventionsService } from '../src/modules/conventions/service.js';

// ------------------------------------------------------------ in-memory store

interface State {
  repos: RepoInfo[];
  scans: ScanRecord[];
  conventions: ConventionRecord[];
  observations: { scanId: string; conventionId: string; o: MergedObservation }[];
  skills: (CreatedSkill & { workspaceId: string })[];
  agents: { id: string; workspaceId: string; links: { skillId: string; enabled: boolean; order: number }[] }[];
  conventionSkills: { conventionId: string; skillId: string }[];
}

let seq = 0;
const newId = (p: string) => `${p}-${++seq}`;

class InMemoryStore implements ConventionStore {
  constructor(public s: State) {}

  async findRepo(workspaceId: string, repoId: string) {
    return this.s.repos.find((r) => r.workspaceId === workspaceId && r.id === repoId);
  }
  async findRunningScan(repoId: string) {
    return this.s.scans.find((x) => x.repoId === repoId && x.status === 'running');
  }
  async insertRunningScan(workspaceId: string, repoId: string) {
    const running = await this.findRunningScan(repoId);
    if (running) throw new ScanRunningError(running.id);
    const scan: ScanRecord = {
      id: newId('scan'),
      workspaceId,
      repoId,
      status: 'running',
      jobId: null,
      attempt: 0,
      commitSha: null,
      sampleFileCount: 0,
      foundCount: 0,
      verifiedCount: 0,
      droppedCount: 0,
      relocatedCount: 0,
      matchedPriorCount: 0,
      duplicateCount: 0,
      retryCount: 0,
      model: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      costSource: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    };
    this.s.scans.push(scan);
    return scan;
  }
  async setScanJob(scanId: string, jobId: string) {
    const scan = this.s.scans.find((x) => x.id === scanId);
    if (scan) scan.jobId = jobId;
  }
  async bumpAttempt(scanId: string) {
    const scan = this.s.scans.find((x) => x.id === scanId && x.status === 'running');
    if (!scan) return undefined;
    scan.attempt += 1;
    return { ...scan };
  }
  private owned(scanId: string, attempt: number) {
    return this.s.scans.find((x) => x.id === scanId && x.status === 'running' && x.attempt === attempt);
  }
  async setScanCommit(scanId: string, attempt: number, sha: string) {
    const scan = this.owned(scanId, attempt);
    if (scan) scan.commitSha = sha;
    return !!scan;
  }
  async failScan(scanId: string, error: string, attempt?: number) {
    const scan =
      attempt !== undefined
        ? this.owned(scanId, attempt)
        : this.s.scans.find((x) => x.id === scanId && x.status === 'running');
    if (!scan) return false;
    Object.assign(scan, { status: 'failed', error, finishedAt: new Date(), retryCount: Math.max(0, scan.attempt - 1) });
    return true;
  }
  async reapRunningScans(error: string) {
    const running = this.s.scans.filter((x) => x.status === 'running');
    for (const r of running) Object.assign(r, { status: 'failed', error });
    return running.length;
  }
  async listPrior(repoId: string, limit: number): Promise<PriorIdentity[]> {
    return this.s.conventions
      .filter((c) => c.repoId === repoId && (c.status !== 'pending' || c.editedAt !== null))
      .slice(0, limit)
      .map((c, i) => ({ ref: `P${i + 1}`, id: c.id, status: c.status, category: c.category, rule: c.rule }));
  }
  private view(c: ConventionRecord): ConventionView {
    const obs = this.s.observations.find((o) => o.conventionId === c.id && o.scanId === c.lastSeenScanId);
    return {
      ...c,
      observation: obs
        ? {
            evidence: obs.o.evidence,
            supportCount: obs.o.supportCount,
            counterCount: obs.o.counterCount,
            reviewHits: obs.o.reviewHits,
            confidence: obs.o.confidence,
          }
        : null,
      lastSeenCommitSha: this.s.scans.find((x) => x.id === c.lastSeenScanId)?.commitSha ?? null,
      skills: this.s.conventionSkills
        .filter((l) => l.conventionId === c.id)
        .map((l) => ({ id: l.skillId, name: this.s.skills.find((k) => k.id === l.skillId)?.name ?? '' })),
    };
  }
  async getPage(workspaceId: string, repoId: string): Promise<ConventionsPageData> {
    const scans = this.s.scans.filter((x) => x.repoId === repoId).reverse();
    return {
      lastScan: scans[0] ?? null,
      runningScan: scans.find((x) => x.status === 'running') ?? null,
      latestDoneScan: scans.find((x) => x.status === 'done') ?? null,
      candidates: this.s.conventions.filter((c) => c.workspaceId === workspaceId && c.repoId === repoId).map((c) => this.view(c)),
    };
  }
  async getCandidate(workspaceId: string, id: string) {
    const c = this.s.conventions.find((x) => x.workspaceId === workspaceId && x.id === id);
    return c ? this.view(c) : undefined;
  }
  async latestDoneScanId(repoId: string) {
    return [...this.s.scans].reverse().find((x) => x.repoId === repoId && x.status === 'done')?.id ?? null;
  }
  async findConventionForUpdate(workspaceId: string, id: string) {
    return this.s.conventions.find((x) => x.workspaceId === workspaceId && x.id === id);
  }
  async updateConvention(workspaceId: string, id: string, write: ConventionWrite) {
    const c = this.s.conventions.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (c) Object.assign(c, write);
  }
  async identityIndex(repoId: string) {
    return new Map(this.s.conventions.filter((c) => c.repoId === repoId).map((c) => [c.fingerprint, c.id]));
  }
  async completeScan(scanId: string, attempt: number, stats: ScanCompletion) {
    const scan = this.owned(scanId, attempt);
    if (!scan) return false;
    Object.assign(scan, stats, { status: 'done', finishedAt: new Date() });
    return true;
  }
  async upsertIdentity(input: { workspaceId: string; repoId: string; observation: MergedObservation; scanId: string }) {
    const o = input.observation;
    const existing = this.s.conventions.find((c) => c.repoId === input.repoId && c.fingerprint === o.fingerprint);
    if (existing) return existing.id;
    const c: ConventionRecord = {
      id: newId('conv'),
      workspaceId: input.workspaceId,
      repoId: input.repoId,
      fingerprint: o.fingerprint,
      category: o.category,
      origin: o.origin,
      rule: o.rule,
      originalRule: o.rule,
      status: 'pending',
      editedAt: null,
      decidedAt: null,
      createdAt: new Date(),
      lastSeenScanId: input.scanId,
    };
    this.s.conventions.push(c);
    return c.id;
  }
  async insertObservation(scanId: string, conventionId: string, o: MergedObservation) {
    if (this.s.observations.some((x) => x.scanId === scanId && x.conventionId === conventionId)) {
      throw new Error('duplicate observation key');
    }
    this.s.observations.push({ scanId, conventionId, o });
  }
  async markSeen(ids: string[], scanId: string) {
    for (const c of this.s.conventions) if (ids.includes(c.id)) c.lastSeenScanId = scanId;
  }
  async applyRetention() {
    return 0;
  }
  async lockConventions(workspaceId: string, repoId: string, ids: string[]) {
    return this.s.conventions.filter((c) => c.workspaceId === workspaceId && c.repoId === repoId && ids.includes(c.id));
  }
  async lastEvidence(ids: string[]): Promise<ConventionEvidence[]> {
    return ids.flatMap((id) => {
      const c = this.s.conventions.find((x) => x.id === id);
      return this.s.observations.find((o) => o.conventionId === id && o.scanId === c?.lastSeenScanId)?.o.evidence ?? [];
    });
  }
  async lockAgents(workspaceId: string, ids: string[]) {
    return this.s.agents.filter((a) => a.workspaceId === workspaceId && ids.includes(a.id)).map((a) => a.id);
  }
  async insertSkill(input: NewExtractedSkill): Promise<CreatedSkill> {
    if (this.s.skills.some((k) => k.workspaceId === input.workspaceId && k.name === input.name)) {
      throw new Error('skill_name_taken');
    }
    const skill = {
      ...input,
      id: newId('skill'),
      type: 'convention' as const,
      source: 'extracted' as const,
      version: 1,
      updatedAt: new Date(),
    };
    this.s.skills.push(skill);
    return skill;
  }
  async agentLinkState(agentId: string): Promise<AgentLinkState> {
    const a = this.s.agents.find((x) => x.id === agentId)!;
    const skills = a.links.map((l) => this.s.skills.find((k) => k.id === l.skillId)!);
    return {
      links: a.links.map((l) => ({ skillId: l.skillId, enabled: l.enabled })),
      skills: skills.map((k) => ({ id: k.id, enabled: k.enabled, body: k.body })),
      maxOrder: a.links.reduce((m, l) => Math.max(m, l.order), -1),
    };
  }
  async appendAgentLink(agentId: string, skillId: string, order: number) {
    this.s.agents.find((x) => x.id === agentId)!.links.push({ skillId, enabled: true, order });
  }
  async linkConventionsToSkill(ids: string[], skillId: string) {
    for (const conventionId of ids) this.s.conventionSkills.push({ conventionId, skillId });
  }
  /** Rollback = restore the snapshot taken before `work`. */
  async transaction<T>(work: (store: ConventionStore) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.s);
    try {
      return await work(this);
    } catch (err) {
      this.s = snapshot;
      throw err;
    }
  }
}

// ------------------------------------------------------------ fixtures

const WS = 'ws-1';
const REPO: RepoInfo = { id: 'repo-1', workspaceId: WS, owner: 'acme', name: 'app', fullName: 'acme/app', clonePath: '/clones/acme/app' };

const FILES: Record<string, string> = {
  'src/a.ts': [
    'export async function loadUser(id: string) {',
    '  const row = await db.select().from(users);',
    "  if (!row) throw new NotFoundError('User not found');",
    '  return row;',
    '}',
  ].join('\n'),
  'src/lib/b.ts': ['export function loadTeam() {', "  throw new NotFoundError('Team not found');", '}'].join('\n'),
};

const GOOD = {
  rule: 'Throw NotFoundError when a lookup finds nothing',
  evidence: [
    { path: 'src/a.ts', quote: "if (!row) throw new NotFoundError('User not found');", line_hint: 3 },
    { path: './src/lib/b.ts:2', quote: "throw new NotFoundError('Team not found');", line_hint: 2 },
  ],
  counter_example: null,
  origin: 'code',
  signal_id: null,
  prior_ref: null,
  category: 'error-handling',
  llm_confidence: 0.9,
};
const OUTSIDE = {
  ...GOOD,
  rule: 'Read secrets from the vault helper',
  evidence: [{ path: 'src/secret.ts', quote: 'const key = vault.read("stripe");', line_hint: 1 }],
};

function emptyState(): State {
  return { repos: [REPO], scans: [], conventions: [], observations: [], skills: [], agents: [], conventionSkills: [] };
}

class HangingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  seen?: StructuredRequest<unknown>;
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(): Promise<CompletionResult> {
    throw new Error('not used');
  }
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.seen = req as StructuredRequest<unknown>;
    return new Promise((_, reject) => {
      req.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
    });
  }
  async embed(): Promise<number[][]> {
    return [];
  }
}

interface Harness {
  service: ConventionsService;
  store: InMemoryStore;
  llm: LLMProvider;
  runJob: () => Promise<void>;
}

function harness(opts: {
  llm?: LLMProvider;
  structured?: unknown;
  files?: Record<string, string>;
  ranked?: string[];
  heads?: string[];
  indexStatus?: string;
  cloneExists?: boolean;
  deadlineMs?: number;
  state?: State;
  signals?: { category: string; title: string; prCount: number; files: string[] }[];
} = {}): Harness {
  const store = new InMemoryStore(opts.state ?? emptyState());
  const files = opts.files ?? FILES;
  const heads = [...(opts.heads ?? ['sha-1'])];
  const llm =
    opts.llm ?? new MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: opts.structured ?? { candidates: [GOOD, OUTSIDE] } } });
  let pending: Promise<void> = Promise.resolve();
  let service!: ConventionsService;
  const deps: ConventionsDeps = {
    store,
    repoIndex: {
      indexStatus: async () => opts.indexStatus ?? 'full',
      topFilesByRank: async () => opts.ranked ?? Object.keys(files),
    },
    reviews: { recurringFindings: async () => opts.signals ?? [] },
    files: {
      cloneRoot: () => '/clones/acme/app',
      cloneExists: async () => opts.cloneExists ?? true,
      assertSafe: async (_root, rel) => {
        if (rel.split('/').includes('..')) throw new UnsafePathError(rel, 'contains ".." segment');
      },
      readFile: async (_ref, rel) => {
        const content = files[rel];
        if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return content;
      },
      currentHead: async () => (heads.length > 1 ? heads.shift()! : heads[0]!),
    },
    models: {
      resolve: async () => ({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' }),
      llm: async () => llm,
    },
    jobs: {
      // One attempt, no retries: `done` rejects like JobRunner's after its last attempt.
      enqueue: async (_ws, payload) => {
        const done = Promise.resolve().then(() => service.runScanJob(payload));
        pending = done.catch(() => undefined).then(() => new Promise<void>((r) => setTimeout(r, 0)));
        return { id: 'job-1', done };
      },
    },
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  };
  service = new ConventionsService(deps);
  return { service, store, llm, runJob: () => pending };
}

async function scanOnce(h: Harness): Promise<ScanRecord> {
  const started = await h.service.startScan(WS, REPO.id);
  await h.runJob();
  return h.store.s.scans.find((s) => s.id === started!.scanId)!;
}

// ------------------------------------------------------------ tests

describe('ConventionsService.startScan', () => {
  it('returns undefined for a repo outside the workspace', async () => {
    expect(await harness().service.startScan('other-ws', REPO.id)).toBeUndefined();
  });

  it('refuses a missing clone dir and an unindexed repo (AC-3)', async () => {
    await expect(harness({ cloneExists: false }).service.startScan(WS, REPO.id)).rejects.toBeInstanceOf(RepoNotClonedError);
    await expect(harness({ indexStatus: 'degraded' }).service.startScan(WS, REPO.id)).rejects.toBeInstanceOf(RepoNotIndexedError);
  });

  it('returns 409 scan_running with the running scan id (AC-2)', async () => {
    const h = harness({ llm: new HangingLLM(), deadlineMs: 5_000 });
    const first = await h.service.startScan(WS, REPO.id);
    const err = await h.service.startScan(WS, REPO.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScanRunningError);
    expect((err as ScanRunningError).details).toEqual({ scan_id: first!.scanId });
  });
});

describe('ConventionsService scan job', () => {
  it('happy path: SAMPLE → PROPOSE → VERIFY → PERSIST', async () => {
    const h = harness();
    const scan = await scanOnce(h);

    expect(scan).toMatchObject({
      status: 'done',
      commitSha: 'sha-1',
      foundCount: 2,
      verifiedCount: 1,
      droppedCount: 1,
      relocatedCount: 0,
      sampleFileCount: 2,
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      costSource: 'estimated',
      retryCount: 0,
      jobId: 'job-1',
    });
    expect(h.store.s.conventions).toHaveLength(1);
    const c = h.store.s.conventions[0]!;
    expect(c).toMatchObject({ status: 'pending', rule: GOOD.rule, lastSeenScanId: scan.id });
    const obs = h.store.s.observations[0]!.o;
    expect(obs.evidence.map((e) => [e.path, e.lineStart, e.snippet])).toEqual([
      ['src/a.ts', 3, "  if (!row) throw new NotFoundError('User not found');"],
      ['src/lib/b.ts', 2, "  throw new NotFoundError('Team not found');"],
    ]);
    expect(obs.supportCount).toBe(2);

    const req = (h.llm as MockLLMProvider).calls.find((x) => x.method === 'completeStructured')!.req as StructuredRequest<unknown>;
    expect(req).toMatchObject({ schemaName: 'ConventionExtraction', maxTokens: 6000, temperature: 0, maxRetries: 1 });
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(req.timeoutMs).toBeGreaterThan(0);
    expect(req.timeoutMs).toBeLessThanOrEqual(100_000);
  });

  it('recurring findings become <untrusted> signals and force their files into the sample (AC-12)', async () => {
    const files = { ...FILES, 'src/handlers/flagged.ts': 'export const flagged = await fetchAll(); // no error handling' };
    const h = harness({
      files,
      ranked: ['src/a.ts', 'src/lib/b.ts'],
      signals: [{ category: 'bug', title: 'Unhandled promise rejection', prCount: 3, files: ['src/handlers/flagged.ts'] }],
      structured: { candidates: [{ ...GOOD, origin: 'review_history', signal_id: 'S1' }] },
    });
    const scan = await scanOnce(h);
    const req = (h.llm as MockLLMProvider).calls[0]!.req as StructuredRequest<unknown>;
    const user = req.messages[1]!.content;
    expect(user).toContain('path: src/handlers/flagged.ts');
    expect(user).toMatch(/<untrusted-[a-z0-9]+ source="review-signals">\nS1 \[bug\] Unhandled promise rejection \(3 PRs/);
    expect(scan.sampleFileCount).toBe(3);
    expect(h.store.s.observations[0]!.o).toMatchObject({ origin: 'review_history', reviewHits: 3 });
  });

  it('drops a path outside the sample', async () => {
    const h = harness({ structured: { candidates: [OUTSIDE] } });
    const scan = await scanOnce(h);
    expect(scan).toMatchObject({ status: 'done', foundCount: 1, verifiedCount: 0, droppedCount: 1 });
    expect(h.store.s.conventions).toHaveLength(0);
  });

  it('a stale attempt writes nothing (CAS on attempt, AC-19)', async () => {
    let store!: InMemoryStore;
    const llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: { candidates: [GOOD] } } });
    const original = llm.completeStructured.bind(llm);
    // A newer attempt takes the row while this one waits on the model.
    llm.completeStructured = async <T,>(req: StructuredRequest<T>) => {
      const scan = store.s.scans[0]!;
      scan.attempt += 1;
      return original(req);
    };
    const h = harness({ llm });
    store = h.store;
    const scan = await scanOnce(h);
    expect(scan.status).toBe('running');
    expect(scan.attempt).toBe(2);
    expect(h.store.s.conventions).toHaveLength(0);
    expect(h.store.s.observations).toHaveLength(0);
  });

  it('deadline abort → the scan fails and nothing is persisted (AC-17)', async () => {
    const llm = new HangingLLM();
    const h = harness({ llm, deadlineMs: 30 });
    const scan = await scanOnce(h);
    expect(llm.seen?.signal?.aborted).toBe(true);
    expect(scan.status).toBe('failed');
    expect(scan.error).toMatch(/^scan_deadline_exceeded: /);
    expect(h.store.s.conventions).toHaveLength(0);
  });

  it('the deadline error is retryable by JobRunner (status 5xx)', async () => {
    const h = harness({ llm: new HangingLLM(), deadlineMs: 10 });
    const scan = await h.store.insertRunningScan(WS, REPO.id);
    const err = await h.service.runScanJob({ scanId: scan.id }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScanTransientError);
    expect((err as ScanTransientError).statusCode).toBeGreaterThanOrEqual(500);
  });

  it('empty sample → failed without an LLM call (AC-10a)', async () => {
    const h = harness({ ranked: [], files: {} });
    const scan = await scanOnce(h);
    expect(scan.status).toBe('failed');
    expect(scan.error).toMatch(/^empty_sample/);
    expect((h.llm as MockLLMProvider).calls).toHaveLength(0);
  });

  it('HEAD moved before PERSIST → the attempt fails with head_moved (AC-9)', async () => {
    const h = harness({ heads: ['sha-1', 'sha-2'] });
    const scan = await scanOnce(h);
    expect(scan.status).toBe('failed');
    expect(scan.error).toMatch(/^head_moved: /);
    expect(h.store.s.conventions).toHaveLength(0);
  });

  it('a file cut by the 60 KB budget is not in the sent set (Trap 6)', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) {
      files[`g${i}/f.ts`] = Array.from(
        { length: 60 },
        (_, n) => `export const value_${i}_${n} = compute(${n}, 'padding-to-make-this-line-long-enough-for-the-budget');`,
      ).join('\n');
    }
    const quote = (i: number) => `export const value_${i}_3 = compute(3, 'padding-to-make-this-line-long-enough-for-the-budget');`;
    const cand = (i: number) => ({
      ...GOOD,
      rule: `Export computed constants from module ${i}`,
      evidence: [{ path: `g${i}/f.ts`, quote: quote(i), line_hint: 4 }],
    });
    const h = harness({ files, structured: { candidates: [cand(0), cand(11)] } });
    const scan = await scanOnce(h);

    const req = (h.llm as MockLLMProvider).calls[0]!.req as StructuredRequest<unknown>;
    const user = req.messages[1]!.content;
    expect(user).toContain('path: g0/f.ts');
    expect(user).not.toContain('path: g11/f.ts');
    expect(scan.sampleFileCount).toBeLessThan(12);
    expect(scan).toMatchObject({ status: 'done', foundCount: 2, verifiedCount: 1 });
    expect(h.store.s.observations[0]!.o.evidence[0]!.path).toBe('g0/f.ts');
  });

  it('a second scan reuses identities and keeps decisions (AC-20, AC-21)', async () => {
    const h = harness({ structured: { candidates: [GOOD] } });
    await scanOnce(h);
    const id = h.store.s.conventions[0]!.id;
    await h.service.update(WS, id, { status: 'rejected' });
    const second = await scanOnce(h);
    expect(second.status).toBe('done');
    expect(second.matchedPriorCount).toBe(1);
    expect(h.store.s.conventions).toHaveLength(1);
    expect(h.store.s.conventions[0]).toMatchObject({ id, status: 'rejected', lastSeenScanId: second.id });
    expect(h.store.s.observations.filter((o) => o.conventionId === id)).toHaveLength(2);
  });
});

describe('ConventionsService.createSkill', () => {
  function stateWithAccepted(bodyBytes = 10): State {
    const s = emptyState();
    s.conventions.push({
      id: 'c-acc',
      workspaceId: WS,
      repoId: REPO.id,
      fingerprint: 'fp1',
      category: 'naming',
      origin: 'code',
      rule: 'Use camelCase names',
      originalRule: 'Use camelCase names',
      status: 'accepted',
      editedAt: null,
      decidedAt: new Date(),
      createdAt: new Date(),
      lastSeenScanId: null,
    });
    s.skills.push({
      id: 'big',
      workspaceId: WS,
      name: 'big',
      description: '',
      type: 'rubric',
      source: 'manual',
      body: 'x'.repeat(bodyBytes),
      enabled: true,
      version: 1,
      evidenceFiles: null,
      needsVetting: false,
      updatedAt: new Date(),
    });
    s.agents.push({ id: 'agent-1', workspaceId: WS, links: [{ skillId: 'big', enabled: true, order: 4 }] });
    return s;
  }

  it('auto-vets, appends the link at max+1 and links the conventions (AC-24, AC-26)', async () => {
    const h = harness({ state: stateWithAccepted() });
    const res = await h.service.createSkill(WS, REPO.id, {
      name: 'app-conventions',
      body: 'Use camelCase names.',
      enabled: true,
      conventionIds: ['c-acc'],
      agentIds: ['agent-1'],
    });
    expect(res.skill).toMatchObject({ source: 'extracted', type: 'convention', enabled: true, needsVetting: false });
    expect(h.store.s.agents[0]!.links.at(-1)).toEqual({ skillId: res.skill.id, enabled: true, order: 5 });
    expect(h.store.s.conventionSkills).toEqual([{ conventionId: 'c-acc', skillId: res.skill.id }]);
  });

  it('over budget → 422 with agent_id and the whole create rolled back (AC-28)', async () => {
    const h = harness({ state: stateWithAccepted(24_570) });
    const err = await h.service
      .createSkill(WS, REPO.id, { name: 'too-big', body: 'y'.repeat(100), enabled: true, conventionIds: ['c-acc'], agentIds: ['agent-1'] })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'agent_skills_budget_exceeded', statusCode: 422, details: { agent_id: 'agent-1' } });
    expect(h.store.s.skills.map((k) => k.name)).toEqual(['big']);
    expect(h.store.s.agents[0]!.links).toHaveLength(1);
    expect(h.store.s.conventionSkills).toHaveLength(0);
  });

  it('refuses a pending convention (422) and a foreign id (404)', async () => {
    const s = stateWithAccepted();
    s.conventions[0]!.status = 'pending';
    const h = harness({ state: s });
    await expect(
      h.service.createSkill(WS, REPO.id, { name: 'n1', body: 'b', enabled: true, conventionIds: ['c-acc'], agentIds: [] }),
    ).rejects.toMatchObject({ code: 'convention_not_accepted', statusCode: 422 });
    await expect(
      h.service.createSkill(WS, REPO.id, { name: 'n2', body: 'b', enabled: true, conventionIds: ['nope'], agentIds: [] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a body whose code block exceeds 12 lines', async () => {
    const h = harness({ state: stateWithAccepted() });
    const body = ['```ts', ...Array.from({ length: 13 }, (_, i) => `line${i}`), '```'].join('\n');
    await expect(
      h.service.createSkill(WS, REPO.id, { name: 'n3', body, enabled: true, conventionIds: ['c-acc'], agentIds: [] }),
    ).rejects.toMatchObject({ code: 'snippet_too_long', statusCode: 422 });
  });
});
