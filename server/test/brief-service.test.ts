/**
 * Brief service (ADR 0022), hermetic: every port is an in-memory fake, the LLM
 * is a scripted provider, jobs are a manual queue (the test decides when a job
 * "settles" and when the handler runs). No Postgres, no Fastify, no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompletionResult,
  FeatureModelChoice,
  LLMProvider,
  ModelInfo,
  PrDetail,
  PrIntentRecord,
  PrRisksRecord,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { ConfigError } from '../src/platform/errors.js';
import {
  AUTO_BRIEF_MAX_ATTEMPTS,
  AUTO_BRIEF_MAX_PER_SYNC,
  INTENT_BUDGET_MS,
  NEGATIVE_CACHE_TTL_MS,
} from '../src/modules/brief/constants.js';
import type {
  BriefFile,
  BriefPull,
  BriefStore,
  IntentWrite,
  RisksWrite,
  ScheduleCandidate,
} from '../src/modules/brief/ports.js';
import { BriefService } from '../src/modules/brief/service.js';
import type { BriefTrigger, DerivePayload } from '../src/modules/brief/types.js';

// ------------------------------------------------------------------ fakes

const T0 = Date.parse('2026-06-01T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const flush = () => new Promise<void>((r) => setImmediate(r));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const INTENT_OK = {
  intent: 'Adds rate limiting to the public API.',
  in_scope: ['limiter middleware'],
  out_of_scope: ['auth'],
  confidence: 'high' as const,
};
const RISKS_OK = {
  risks: [
    { kind: 'security' as const, title: 'Limiter bypass', explanation: 'Header spoofing may bypass it.', severity: 'high' as const, file_refs: ['src/a.ts'] },
  ],
};

class ScriptedLLM implements LLMProvider {
  readonly id = 'openrouter' as unknown as LLMProvider['id'];
  calls: { schemaName: string; model: string }[] = [];
  /** Errors to throw per schemaName. */
  errors: Record<string, Error | undefined> = {};
  /** When set, every call waits for it. */
  gate?: Promise<void>;
  costs: { usd: number | null; source: 'provider' | 'estimated' | null } = { usd: 0.002, source: 'provider' };

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(): Promise<CompletionResult> {
    throw new Error('not used');
  }
  async embed(): Promise<number[][]> {
    return [];
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ schemaName: req.schemaName, model: req.model });
    if (this.gate) await this.gate;
    const err = this.errors[req.schemaName];
    if (err) throw err;
    const data = req.schemaName === 'pr_intent' ? INTENT_OK : RISKS_OK;
    return {
      data: data as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 20,
      costUsd: this.costs.usd,
      costSource: this.costs.source,
      raw: '{}',
      attempts: 1,
    };
  }
  count(schemaName: string) {
    return this.calls.filter((c) => c.schemaName === schemaName).length;
  }
}

/** A GitHub detail whose head differs from the persisted `h1`. */
const MOVED_DETAIL = {
  number: 7, title: 't', author: 'a', branch: 'b', base: 'main', head_sha: 'other',
  additions: 1, deletions: 0, files_count: 1, status: 'open', body: 'x', files: [], commits: [], linked_issue: null,
} as PrDetail;

const FILES_DETAIL = [
  { path: 'src/a.ts', additions: 4, deletions: 0, patch: '@@ -1,2 +1,5 @@\n a\n+b\n+c\n+d\n e' },
  { path: 'package.json', additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n {\n+"x":1' },
];

function makePull(over: Partial<BriefPull> = {}): BriefPull {
  return {
    id: 'pr1',
    workspaceId: 'ws',
    repoId: 'repo1',
    number: 7,
    title: 'Add rate limiting',
    branch: 'feat/rate',
    base: 'main',
    headSha: 'h1',
    body: 'Adds rate limiting to the public API so abusive clients get throttled. Closes #5.',
    status: 'open',
    additions: 5,
    deletions: 0,
    filesCount: 2,
    ...over,
  };
}

interface SetupOpts {
  pull?: Partial<BriefPull>;
  autoBriefEnabled?: boolean;
  workspaceAuto?: boolean;
  configured?: boolean;
  useRealClock?: boolean;
}

function setup(opts: SetupOpts = {}) {
  let clock = T0;
  let pull: BriefPull | undefined = makePull(opts.pull);
  const intents = new Map<string, PrIntentRecord>();
  const risks = new Map<string, PrRisksRecord>();
  const writes = { intent: [] as IntentWrite[], risks: [] as RisksWrite[] };
  let candidates: ScheduleCandidate[] = [];
  let candidatesError: Error | undefined;
  let storeGetError: Error | undefined;

  const store: BriefStore = {
    getIntent: async (id) => {
      if (storeGetError) throw storeGetError;
      return intents.get(id);
    },
    getRisks: async (id) => risks.get(id),
    upsertIntent: async (id, w) => {
      writes.intent.push(w);
      intents.set(id, {
        pr_id: id,
        intent: w.intent,
        in_scope: w.inScope,
        out_of_scope: w.outOfScope,
        head_sha: w.headSha,
        confidence: w.confidence,
        sources: w.sources,
        unresolved_links: w.unresolvedLinks,
        provider: w.provider as PrIntentRecord['provider'],
        model: w.model,
        tokens_in: w.tokensIn,
        tokens_out: w.tokensOut,
        cost_usd: w.costUsd,
        cost_source: w.costSource,
        derived_at: iso(clock),
      });
    },
    upsertRisks: async (id, w) => {
      writes.risks.push(w);
      risks.set(id, {
        pr_id: id,
        head_sha: w.headSha,
        risks: w.risks,
        dropped_refs: w.droppedRefs,
        rule_only: w.ruleOnly,
        provider: w.provider as PrRisksRecord['provider'],
        model: w.model,
        tokens_in: w.tokensIn,
        tokens_out: w.tokensOut,
        cost_usd: w.costUsd,
        cost_source: w.costSource,
        derived_at: iso(clock),
      });
    },
    listScheduleCandidates: async () => {
      if (candidatesError) throw candidatesError;
      return candidates;
    },
  };

  const llm = new ScriptedLLM();
  const choices: Record<string, FeatureModelChoice> = {
    review_intent: { provider: 'openrouter', model: 'intent-A' },
    risk_brief: { provider: 'openrouter', model: 'risk-A' },
  };
  const resolved: string[] = [];
  const state = {
    workspaceAuto: opts.workspaceAuto ?? true,
    configured: opts.configured ?? true,
    settingsError: undefined as Error | undefined,
    llmError: undefined as Error | undefined,
    detail: undefined as PrDetail | Error | 'hang' | undefined,
    enqueueError: undefined as Error | undefined,
    files: FILES_DETAIL as BriefFile[],
  };
  const detailFor = (p: BriefPull): PrDetail =>
    ({
      number: p.number,
      title: p.title,
      author: 'sam',
      branch: p.branch,
      base: p.base,
      head_sha: p.headSha,
      additions: 5,
      deletions: 0,
      files_count: 2,
      status: 'open',
      body: p.body,
      files: FILES_DETAIL,
      commits: [{ sha: 'c1', message: 'add limiter', author: 'sam', committed_at: null }],
      linked_issue: null,
    }) as PrDetail;

  const jobs = {
    enqueued: [] as DerivePayload[],
    dones: [] as ReturnType<typeof deferred>[],
    enqueue: async (_ws: string, payload: DerivePayload) => {
      if (state.enqueueError) throw state.enqueueError;
      const d = deferred();
      jobs.enqueued.push(payload);
      jobs.dones.push(d);
      return { done: d.promise };
    },
  };

  const logs = { warn: [] as { obj: Record<string, unknown>; msg: string }[] };
  const svc = new BriefService({
    store,
    pulls: {
      getPull: async (_ws, id) => (pull && id === pull.id ? pull : undefined),
      getRepo: async () => ({ id: 'repo1', owner: 'acme', name: 'api' }),
      getFiles: async () => state.files,
      getCommits: async () => [{ message: 'persisted commit' }],
    },
    github: {
      getPullDetail: async () => {
        if (state.detail instanceof Error) throw state.detail;
        if (state.detail === 'hang') return new Promise<PrDetail>(() => undefined);
        return state.detail ?? detailFor(pull!);
      },
      getIssue: async (_r, n) => ({ number: n, title: `Issue ${n}`, body: 'issue body', state: 'open' }),
    },
    git: {
      readFileAtRef: async () => ({ status: 'not_found' }),
      fetchPullHead: async () => undefined,
    },
    models: {
      resolve: async (_ws, id) => {
        resolved.push(id);
        return choices[id]!;
      },
      llm: async () => {
        if (state.llmError) throw state.llmError;
        return llm;
      },
      isConfigured: async () => state.configured,
    },
    settings: {
      autoBrief: async () => {
        if (state.settingsError) throw state.settingsError;
        return state.workspaceAuto;
      },
    },
    jobs,
    diff: { parse: (raw) => parseUnifiedDiff(raw) },
    log: {
      debug() {},
      info() {},
      warn: (obj, msg) => logs.warn.push({ obj, msg }),
    },
    autoBriefEnabled: opts.autoBriefEnabled ?? true,
    ...(opts.useRealClock ? {} : { now: () => clock }),
  });

  const payload = (trigger: BriefTrigger, enqueuedAt = iso(clock)): DerivePayload => ({
    workspaceId: 'ws',
    prId: 'pr1',
    trigger,
    enqueuedAt,
  });
  const derive = (trigger: BriefTrigger, enqueuedAt?: string) => svc.derive('ws', 'pr1', payload(trigger, enqueuedAt));

  return {
    svc,
    llm,
    jobs,
    logs,
    writes,
    intents,
    risks,
    choices,
    resolved,
    state,
    derive,
    payload,
    advance: (ms: number) => (clock += ms),
    setPull: (p: Partial<BriefPull> | undefined) => (pull = p ? { ...pull!, ...p } : undefined),
    setCandidates: (c: ScheduleCandidate[]) => (candidates = c),
    failCandidates: (e: Error) => (candidatesError = e),
    failStoreGet: (e: Error) => (storeGetError = e),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------ gate + requestDerive

describe('requestDerive: the automatic gate', () => {
  it('a PR outside the workspace is undefined and nothing is enqueued', async () => {
    const s = setup();
    s.setPull(undefined);
    expect(await s.svc.requestDerive('ws', 'pr1', 'on_demand')).toBeUndefined();
    expect(s.jobs.enqueued).toHaveLength(0);
  });

  it('every gate input closes the automatic path: env kill-switch, workspace toggle, provider', async () => {
    const off = setup({ autoBriefEnabled: false });
    expect(await off.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });

    const ws = setup({ workspaceAuto: false });
    expect(await ws.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });

    const noProvider = setup({ configured: false });
    expect(await noProvider.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });

    expect([off, ws, noProvider].flatMap((s) => s.jobs.enqueued)).toHaveLength(0);
  });

  it('on_demand bypasses the gate entirely (button works with the toggle off and no provider)', async () => {
    const s = setup({ autoBriefEnabled: false, workspaceAuto: false, configured: false });
    expect(await s.svc.requestDerive('ws', 'pr1', 'on_demand')).toEqual({ queued: true });
    expect(s.jobs.enqueued).toEqual([expect.objectContaining({ trigger: 'on_demand', prId: 'pr1', workspaceId: 'ws' })]);
    expect(Number.isNaN(Date.parse(s.jobs.enqueued[0]!.enqueuedAt))).toBe(false);
  });

  it('an open gate queues an automatic trigger; toggling the workspace setting back applies to the next call', async () => {
    const s = setup({ workspaceAuto: false });
    expect(await s.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });
    s.state.workspaceAuto = true;
    expect(await s.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: true });
  });

  it('a non-open PR, or one with both rows current, is not queued automatically', async () => {
    const closed = setup({ pull: { status: 'merged' } });
    expect(await closed.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });

    const done = setup();
    await done.derive('on_demand');
    expect(await done.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });
    // ...but the button still redoes it
    expect(await done.svc.requestDerive('ws', 'pr1', 'on_demand')).toEqual({ queued: true });
  });

  it('a PR already queued is not double-queued by an automatic trigger', async () => {
    const s = setup();
    expect(await s.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: true });
    expect(await s.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });
    expect(s.jobs.enqueued).toHaveLength(1);
  });

  it('a throwing gate resolves { queued:false } with a warn instead of rejecting', async () => {
    const s = setup();
    s.state.settingsError = new Error('db down');
    await expect(s.svc.requestDerive('ws', 'pr1', 'review_prework')).resolves.toEqual({ queued: false });
    expect(s.logs.warn.map((w) => w.msg)).toContain('brief: request gate failed');
  });
});

describe('requestDerive: onlyIfIdle (Prepare overview, spec 06 D8)', () => {
  it('two concurrent on_demand idle-only requests enqueue one job', async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      s.svc.requestDerive('ws', 'pr1', 'on_demand', { onlyIfIdle: true }),
      s.svc.requestDerive('ws', 'pr1', 'on_demand', { onlyIfIdle: true }),
    ]);
    expect([a, b]).toEqual(expect.arrayContaining([{ queued: true }, { queued: false }]));
    expect(s.jobs.enqueued).toHaveLength(1);
  });

  it('with a job already queued → { queued:false }, nothing enqueued', async () => {
    const s = setup();
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    expect(await s.svc.requestDerive('ws', 'pr1', 'on_demand', { onlyIfIdle: true })).toEqual({ queued: false });
    expect(s.jobs.enqueued).toHaveLength(1);
  });

  it('without the option the old behaviour is unchanged (enqueue every time)', async () => {
    const s = setup();
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    expect(await s.svc.requestDerive('ws', 'pr1', 'on_demand')).toEqual({ queued: true });
    expect(s.jobs.enqueued).toHaveLength(2);
  });

  it('a foreign PR is still undefined', async () => {
    const s = setup();
    s.setPull(undefined);
    expect(await s.svc.requestDerive('ws', 'pr1', 'on_demand', { onlyIfIdle: true })).toBeUndefined();
    expect(s.jobs.enqueued).toHaveLength(0);
  });
});

describe('requestDerive: enqueue failure', () => {
  it('on_demand rethrows and the queued mark is cleared', async () => {
    const s = setup();
    s.state.enqueueError = new Error('queue full');
    await expect(s.svc.requestDerive('ws', 'pr1', 'on_demand')).rejects.toThrow('queue full');
    expect(s.svc.isInFlight('pr1')).toBe(false);
  });

  it('review_prework resolves { queued:false } with a warn log and clears the mark', async () => {
    const s = setup();
    s.state.enqueueError = new Error('queue full');
    await expect(s.svc.requestDerive('ws', 'pr1', 'review_prework')).resolves.toEqual({ queued: false });
    expect(s.logs.warn.map((w) => w.msg)).toContain('brief: enqueue failed');
    expect(s.svc.isInFlight('pr1')).toBe(false);
    // the mark really is gone: the next attempt can queue
    s.state.enqueueError = undefined;
    expect(await s.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: true });
  });
});

// ------------------------------------------------------------------ queued bookkeeping

describe('in_flight bookkeeping: `queued` is released exactly once when the job settles', () => {
  it('queued -> in_flight; done resolving releases it', async () => {
    const s = setup();
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    expect(s.svc.isInFlight('pr1')).toBe(true);
    s.jobs.dones[0]!.resolve();
    await flush();
    expect(s.svc.isInFlight('pr1')).toBe(false);
  });

  it('two queued jobs need two settles (a double decrement would drop in_flight early)', async () => {
    const s = setup();
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    s.jobs.dones[0]!.resolve();
    await flush();
    expect(s.svc.isInFlight('pr1')).toBe(true);
    s.jobs.dones[1]!.resolve();
    await flush();
    expect(s.svc.isInFlight('pr1')).toBe(false);
  });

  it('done rejecting before the handler ever runs (timeout / pre-handler failure) still releases the mark', async () => {
    const s = setup();
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    s.jobs.dones[0]!.reject(new Error('job timed out'));
    await flush();
    expect(s.svc.isInFlight('pr1')).toBe(false);
  });

  it('a late handler after done settled does not drive queued negative (PR can be queued again)', async () => {
    const s = setup();
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    s.jobs.dones[0]!.resolve();
    await flush();
    await s.derive('on_demand'); // handler runs after the settle
    expect(s.svc.isInFlight('pr1')).toBe(false);
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    expect(s.svc.isInFlight('pr1')).toBe(true);
  });

  it('timeout: done settles while the handler is still running -> in_flight stays true until it finishes', async () => {
    const s = setup();
    const gate = deferred();
    s.llm.gate = gate.promise;
    await s.svc.requestDerive('ws', 'pr1', 'on_demand');
    const running = s.derive('on_demand');
    await flush();
    expect(s.llm.calls.length).toBeGreaterThan(0); // handler is mid-LLM

    s.jobs.dones[0]!.reject(new Error('timed out after 150000ms'));
    await flush();
    expect(s.svc.isInFlight('pr1')).toBe(true); // the work is still running

    gate.resolve();
    await running;
    expect(s.svc.isInFlight('pr1')).toBe(false);
  });
});

// ------------------------------------------------------------------ derive

describe('derive: success path', () => {
  it('stores intent and risks with the cost pairs, provider and model, and resolves models per phase', async () => {
    const s = setup();
    expect(await s.derive('on_demand')).toEqual({ ok: true });
    expect(s.resolved).toEqual(['review_intent', 'risk_brief']);
    expect(s.llm.calls.map((c) => [c.schemaName, c.model])).toEqual([
      ['pr_intent', 'intent-A'],
      ['pr_risks', 'risk-A'],
    ]);
    expect(s.writes.intent[0]).toMatchObject({ headSha: 'h1', provider: 'openrouter', model: 'intent-A', costUsd: 0.002, costSource: 'provider', tokensIn: 100 });
    expect(s.writes.risks[0]).toMatchObject({ headSha: 'h1', ruleOnly: false, model: 'risk-A', costUsd: 0.002, costSource: 'provider' });
    // rule pass + model pass merged: package.json rule risk and the grounded model risk
    expect(s.writes.risks[0]!.risks.map((r) => `${r.origin}:${r.kind}`).sort()).toEqual(['model:security', 'rule:deps']);
    const view = await s.svc.getIntent('ws', 'pr1');
    expect(view).toMatchObject({ stale: false, inFlight: false, lastFailure: null });
    expect(view!.record!.intent).toBe(INTENT_OK.intent);
  });

  it('stores a null cost as a null PAIR when the provider reports no cost', async () => {
    const s = setup();
    s.llm.costs = { usd: null, source: null };
    await s.derive('on_demand');
    for (const w of [s.writes.intent[0]!, s.writes.risks[0]!]) {
      expect(w.costUsd).toBeNull();
      expect(w.costSource).toBeNull();
    }
  });

  it('feature models are resolved on every job: a settings change applies to the next job', async () => {
    const s = setup();
    await s.derive('on_demand', iso(T0));
    s.choices.review_intent = { provider: 'openrouter', model: 'intent-B' };
    s.choices.risk_brief = { provider: 'openrouter', model: 'risk-B' };
    s.advance(60_000);
    await s.derive('on_demand', iso(T0 + 60_000)); // enqueued after the first row was written
    expect(s.llm.calls.map((c) => c.model)).toEqual(['intent-A', 'risk-A', 'intent-B', 'risk-B']);
  });

  it('getIntent reports stale when the stored row belongs to an older head', async () => {
    const s = setup();
    await s.derive('on_demand');
    s.setPull({ headSha: 'h2' });
    expect(await s.svc.getIntent('ws', 'pr1')).toMatchObject({ stale: true });
    expect(await s.svc.getRisks('ws', 'pr1')).toMatchObject({ stale: true });
  });

  it('a foreign PR has no view', async () => {
    const s = setup();
    expect(await s.svc.getIntent('ws', 'nope')).toBeUndefined();
    expect(await s.svc.getRisks('ws', 'nope')).toBeUndefined();
  });
});

describe('derive: freshness and concurrency', () => {
  it('an automatic trigger never redoes a current row', async () => {
    const s = setup();
    await s.derive('on_demand');
    const before = s.llm.calls.length;
    expect(await s.derive('review_prework')).toEqual({ ok: true });
    expect(s.llm.calls.length).toBe(before);
  });

  it('on_demand redoes a current row, unless a newer row was written after it was enqueued', async () => {
    const s = setup();
    await s.derive('on_demand', iso(T0));
    expect(s.llm.calls).toHaveLength(2);

    s.advance(1000);
    await s.derive('on_demand', iso(T0 + 1000)); // enqueued later than the row
    expect(s.llm.calls).toHaveLength(4);

    // the row (derived at T0+1000) is newer than this enqueue time -> skip
    await s.derive('on_demand', iso(T0 - 5000));
    expect(s.llm.calls).toHaveLength(4);
  });

  it('a stale-head row is redone by an automatic trigger', async () => {
    const s = setup();
    await s.derive('on_demand');
    s.setPull({ headSha: 'h2' });
    await s.derive('review_prework');
    expect(s.writes.intent.map((w) => w.headSha)).toEqual(['h1', 'h2']);
  });

  it('requestDerive + a concurrent job: one LLM call per phase', async () => {
    const s = setup();
    const gate = deferred();
    s.llm.gate = gate.promise;
    const a = s.derive('on_demand');
    const b = s.derive('on_demand');
    await flush();
    gate.resolve();
    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }]);
    expect(s.llm.count('pr_intent')).toBe(1);
    expect(s.llm.count('pr_risks')).toBe(1);
  });

  it('a PR that vanished yields no_pull and stores nothing', async () => {
    const s = setup();
    s.setPull(undefined);
    expect(await s.derive('on_demand')).toEqual({ ok: false, reason: 'no_pull' });
    expect(s.writes.intent).toHaveLength(0);
  });

  it('the handler never throws: an unexpected store error becomes { ok:false, reason:"internal" }', async () => {
    const s = setup();
    s.failStoreGet(new Error('db exploded'));
    await expect(s.derive('on_demand')).resolves.toEqual({ ok: false, reason: 'internal' });
    expect(s.logs.warn.map((w) => w.msg)).toContain('brief: derive crashed');
  });
});

describe('derive: failures', () => {
  it('intent LLM failure -> intent lastFailure only; risks still run with rules and the model', async () => {
    const s = setup();
    s.llm.errors.pr_intent = new Error('upstream 500');
    expect(await s.derive('on_demand')).toEqual({ ok: false, reason: 'llm_error' });
    expect(s.writes.intent).toHaveLength(0);
    expect(s.writes.risks).toHaveLength(1);
    expect(s.writes.risks[0]!.ruleOnly).toBe(false);
    expect((await s.svc.getIntent('ws', 'pr1'))!.lastFailure).toMatchObject({ reason: 'llm_error' });
    expect((await s.svc.getRisks('ws', 'pr1'))!.lastFailure).toBeNull();
  });

  it('risks LLM failure -> rule_only row with a null cost pair; the failure shows only on getRisks', async () => {
    const s = setup();
    s.llm.errors.pr_risks = new Error('upstream 500');
    expect(await s.derive('on_demand')).toEqual({ ok: false, reason: 'llm_error' });
    expect(s.writes.risks[0]).toMatchObject({
      ruleOnly: true,
      provider: null,
      model: null,
      costUsd: null,
      costSource: null,
      tokensIn: null,
    });
    expect(s.writes.risks[0]!.risks.map((r) => r.kind)).toEqual(['deps']);
    expect((await s.svc.getRisks('ws', 'pr1'))!.lastFailure).toMatchObject({ reason: 'llm_error' });
    expect((await s.svc.getIntent('ws', 'pr1'))!.lastFailure).toBeNull();
  });

  it('classifies errors: parse, timeout and provider_not_configured get distinct reasons', async () => {
    const parse = setup();
    parse.llm.errors.pr_intent = new Error('schema validation failed');
    expect(await parse.derive('on_demand')).toEqual({ ok: false, reason: 'parse_error' });

    const timeout = setup();
    timeout.llm.errors.pr_intent = Object.assign(new Error('x'), { name: 'TimeoutError' });
    expect(await timeout.derive('on_demand')).toEqual({ ok: false, reason: 'timeout' });

    const noKey = setup();
    noKey.state.llmError = new ConfigError('no key');
    expect(await noKey.derive('on_demand')).toEqual({ ok: false, reason: 'provider_not_configured' });
    expect((await noKey.svc.getIntent('ws', 'pr1'))!.lastFailure?.reason).toBe('provider_not_configured');
  });

  it('the next success clears lastFailure; a new head starts with none', async () => {
    const s = setup();
    s.llm.errors.pr_intent = new Error('boom');
    await s.derive('on_demand');
    expect((await s.svc.getIntent('ws', 'pr1'))!.lastFailure).not.toBeNull();

    s.setPull({ headSha: 'h2' });
    expect((await s.svc.getIntent('ws', 'pr1'))!.lastFailure).toBeNull();
    s.setPull({ headSha: 'h1' });

    s.llm.errors.pr_intent = undefined;
    s.advance(10);
    expect(await s.derive('on_demand', iso(T0 + 10))).toEqual({ ok: true });
    expect((await s.svc.getIntent('ws', 'pr1'))!.lastFailure).toBeNull();
  });

  it('automatic trigger + failed detail fetch: nothing is stored; on_demand falls back to the persisted rows', async () => {
    const auto = setup();
    auto.state.detail = new Error('github 502');
    expect(await auto.derive('review_prework')).toEqual({ ok: false, reason: 'internal' });
    expect(auto.writes.intent).toHaveLength(0);
    expect(auto.writes.risks).toHaveLength(0);
    expect(auto.llm.calls).toHaveLength(0);

    const manual = setup();
    manual.state.detail = new Error('github 502');
    expect(await manual.derive('on_demand')).toEqual({ ok: true });
    expect(manual.writes.intent).toHaveLength(1);
    expect(manual.writes.intent[0]!.sources.some((x) => x.ref === 'persisted')).toBe(true);
    expect(manual.writes.risks).toHaveLength(1);
  });

  it('a live head that differs from the persisted one stores nothing and records head_moved for both phases', async () => {
    const s = setup();
    s.state.detail = MOVED_DETAIL;
    expect(await s.derive('review_prework')).toEqual({ ok: false, reason: 'head_moved' });
    expect(s.llm.calls).toHaveLength(0);
    expect(s.writes.intent).toHaveLength(0);
    expect((await s.svc.getIntent('ws', 'pr1'))!.lastFailure?.reason).toBe('head_moved');
    expect((await s.svc.getRisks('ws', 'pr1'))!.lastFailure?.reason).toBe('head_moved');
  });

  it('budget: a never-resolving GitHub fetch times out the phase (fake timers) and is recorded as timeout', async () => {
    vi.useFakeTimers();
    const s = setup({ useRealClock: true });
    s.state.detail = 'hang';

    const p = s.svc.derive('ws', 'pr1', s.payload('review_prework', new Date().toISOString()));
    await vi.advanceTimersByTimeAsync(INTENT_BUDGET_MS + 1);
    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(s.llm.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ negative cache, attempts, scheduler

const cand = (n: number, extra: Partial<ScheduleCandidate> = {}): ScheduleCandidate => ({
  prId: `pr${n}`,
  headSha: 'h1',
  hasIntent: false,
  hasRisks: false,
  ...extra,
});

describe('negative cache and attempt cap', () => {
  it('llm_error is negative-cached for 10 min: the scheduler skips the PR, then retries after the TTL', async () => {
    const s = setup();
    s.llm.errors.pr_intent = new Error('boom');
    s.llm.errors.pr_risks = new Error('boom');
    await s.derive('on_demand');
    s.setCandidates([cand(1)]);

    await s.svc.scheduleForRepo('ws', 'repo1', 'poll');
    expect(s.jobs.enqueued).toHaveLength(0);

    s.advance(NEGATIVE_CACHE_TTL_MS + 1);
    await s.svc.scheduleForRepo('ws', 'repo1', 'poll');
    expect(s.jobs.enqueued).toHaveLength(1);
  });

  it('provider_not_configured is NOT negative-cached: adding the key works on the very next pass', async () => {
    const s = setup();
    s.state.llmError = new ConfigError('no key');
    await s.derive('on_demand');
    s.state.llmError = undefined;
    s.setCandidates([cand(1)]);
    await s.svc.scheduleForRepo('ws', 'repo1', 'poll');
    expect(s.jobs.enqueued).toHaveLength(1);
  });

  it('a success clears the negative entry', async () => {
    const s = setup();
    s.llm.errors.pr_intent = new Error('boom');
    await s.derive('on_demand');
    s.llm.errors.pr_intent = undefined;
    s.advance(5);
    await s.derive('on_demand', iso(T0 + 5));
    // The store (fake) still lists the PR as lacking an intent; only a leftover negative entry could block it.
    s.setCandidates([cand(1, { hasRisks: true })]);
    await s.svc.scheduleForRepo('ws', 'repo1', 'poll');
    expect(s.jobs.enqueued).toHaveLength(1);
  });

  it(`automatic failures count toward a cap of ${AUTO_BRIEF_MAX_ATTEMPTS}; after it only the button retries`, async () => {
    const s = setup();
    s.state.detail = new Error('github 502'); // 'internal': not negative-cached, counts as an attempt
    for (let i = 0; i < AUTO_BRIEF_MAX_ATTEMPTS; i++) await s.derive('review_prework');
    await s.svc.scheduleForPull('ws', 'pr1', 'detail');
    expect(s.jobs.enqueued).toHaveLength(0);
    expect(await s.svc.requestDerive('ws', 'pr1', 'review_prework')).toEqual({ queued: false });
    expect(await s.svc.requestDerive('ws', 'pr1', 'on_demand')).toEqual({ queued: true });
  });

  it('head_moved does not count toward the cap', async () => {
    const s = setup();
    s.state.detail = MOVED_DETAIL;
    for (let i = 0; i < AUTO_BRIEF_MAX_ATTEMPTS + 2; i++) await s.derive('review_prework');
    await s.svc.scheduleForPull('ws', 'pr1', 'detail');
    expect(s.jobs.enqueued).toHaveLength(1);
  });
});

describe('scheduling', () => {
  it(`25 candidates -> only ${AUTO_BRIEF_MAX_PER_SYNC} enqueued, in the store's order`, async () => {
    const s = setup();
    s.setCandidates(Array.from({ length: 25 }, (_, i) => cand(i + 1)));
    await s.svc.scheduleForRepo('ws', 'repo1', 'list_sync');
    expect(s.jobs.enqueued.map((p) => p.prId)).toEqual(Array.from({ length: 10 }, (_, i) => `pr${i + 1}`));
    expect(s.jobs.enqueued.every((p) => p.trigger === 'list_sync')).toBe(true);
  });

  it('12 candidates with the top 10 already queued -> the remaining 2 are enqueued (skips come before the cap)', async () => {
    const s = setup();
    const all = Array.from({ length: 12 }, (_, i) => cand(i + 1));
    s.setCandidates(all);
    await s.svc.scheduleForRepo('ws', 'repo1', 'list_sync'); // queues pr1..pr10, their jobs stay unsettled
    await s.svc.scheduleForRepo('ws', 'repo1', 'poll');
    expect(s.jobs.enqueued.map((p) => p.prId)).toEqual([...all.slice(0, 10), ...all.slice(10)].map((c) => c.prId));
    expect(s.jobs.enqueued).toHaveLength(12);
  });

  it('a closed gate (env, workspace toggle, provider) enqueues nothing', async () => {
    for (const o of [{ autoBriefEnabled: false }, { workspaceAuto: false }, { configured: false }]) {
      const s = setup(o);
      s.setCandidates([cand(1)]);
      await s.svc.scheduleForRepo('ws', 'repo1', 'poll');
      await s.svc.scheduleForPull('ws', 'pr1', 'detail');
      expect(s.jobs.enqueued).toHaveLength(0);
    }
  });

  it('a scheduler error is swallowed with a warn (never rejects into the list sync)', async () => {
    const s = setup();
    s.failCandidates(new Error('query failed'));
    await expect(s.svc.scheduleForRepo('ws', 'repo1', 'poll')).resolves.toBeUndefined();
    expect(s.logs.warn.map((w) => w.msg)).toContain('brief: scheduling failed');
  });

  it('scheduleForPull: skips closed/merged and fully-fresh PRs, queues one lacking a row', async () => {
    const merged = setup({ pull: { status: 'merged' } });
    await merged.svc.scheduleForPull('ws', 'pr1', 'detail');
    expect(merged.jobs.enqueued).toHaveLength(0);

    const s = setup();
    await s.svc.scheduleForPull('ws', 'pr1', 'detail');
    expect(s.jobs.enqueued).toHaveLength(1);

    const fresh = setup();
    await fresh.derive('on_demand');
    await fresh.svc.scheduleForPull('ws', 'pr1', 'detail');
    expect(fresh.jobs.enqueued).toHaveLength(0);
  });

  it('a failing enqueue for one candidate does not stop the pass', async () => {
    const s = setup();
    s.setCandidates([cand(1), cand(2)]);
    s.state.enqueueError = new Error('queue full');
    await expect(s.svc.scheduleForRepo('ws', 'repo1', 'poll')).resolves.toBeUndefined();
    expect(s.svc.isInFlight('pr1')).toBe(false);
  });
});

describe('readFreshIntent (review pre-work: read only)', () => {
  it('missing / stale / fresh', async () => {
    const s = setup();
    expect(await s.svc.readFreshIntent('pr1', 'h1')).toEqual({ ok: false, reason: 'missing' });
    await s.derive('on_demand');
    expect(await s.svc.readFreshIntent('pr1', 'h2')).toEqual({ ok: false, reason: 'stale' });
    const fresh = await s.svc.readFreshIntent('pr1', 'h1');
    expect(fresh).toMatchObject({ ok: true, headSha: 'h1', provider: 'openrouter', model: 'intent-A' });
    expect(s.llm.calls).toHaveLength(2); // the read made no LLM call
  });

  it('a blank stored intent counts as missing', async () => {
    const s = setup();
    await s.derive('on_demand');
    s.intents.get('pr1')!.intent = '   ';
    expect(await s.svc.readFreshIntent('pr1', 'h1')).toEqual({ ok: false, reason: 'missing' });
  });
});
