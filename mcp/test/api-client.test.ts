import { describe, expect, it } from 'vitest';
import { HttpDevDigestApi } from '../src/api/client.js';
import { ApiError, isTransient } from '../src/api/errors.js';
import {
  agentJson,
  blastJson,
  candidateJson,
  conventionsJson,
  findingJson,
  prJson,
  repoJson,
  reviewJson,
  runJson,
} from './fixtures.js';

const BASE = 'http://127.0.0.1:3001';

interface Call {
  method: string;
  url: string;
  body: string | undefined;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function recordingApi(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { api: new HttpDevDigestApi(BASE, 5_000, fetchImpl), calls };
}

async function catchApiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected an ApiError');
}

describe('HttpDevDigestApi — the permission boundary (AC-21)', () => {
  it('exposes exactly the eight D7 methods', () => {
    const names = Object.getOwnPropertyNames(HttpDevDigestApi.prototype)
      .filter((n) => n !== 'constructor')
      .sort();
    expect(names).toEqual(
      [
        'getBlastRadius',
        'getConventions',
        'listAgents',
        'listPulls',
        'listRepos',
        'listReviews',
        'listRuns',
        'startReview',
      ].sort(),
    );
  });

  const cases: Array<{
    name: string;
    invoke: (api: HttpDevDigestApi) => Promise<unknown>;
    method: string;
    url: string;
    reply: unknown;
    body?: unknown;
  }> = [
    { name: 'listRepos', invoke: (a) => a.listRepos(), method: 'GET', url: `${BASE}/repos`, reply: [repoJson()] },
    {
      name: 'listPulls',
      invoke: (a) => a.listPulls('a/b?c'),
      method: 'GET',
      url: `${BASE}/repos/a%2Fb%3Fc/pulls`,
      reply: [prJson()],
    },
    { name: 'listAgents', invoke: (a) => a.listAgents(), method: 'GET', url: `${BASE}/agents`, reply: [agentJson()] },
    {
      name: 'startReview',
      invoke: (a) => a.startReview('a/b?c', 'agent-1'),
      method: 'POST',
      url: `${BASE}/pulls/a%2Fb%3Fc/review`,
      reply: { pr_id: 'p', runs: [{ run_id: 'r', agent_id: 'agent-1', agent_name: 'A' }], reviews: [] },
      body: { agentId: 'agent-1' },
    },
    {
      name: 'listRuns',
      invoke: (a) => a.listRuns('a/b?c'),
      method: 'GET',
      url: `${BASE}/pulls/a%2Fb%3Fc/runs`,
      reply: [runJson()],
    },
    {
      name: 'listReviews',
      invoke: (a) => a.listReviews('a/b?c'),
      method: 'GET',
      url: `${BASE}/pulls/a%2Fb%3Fc/reviews`,
      reply: [reviewJson()],
    },
    {
      name: 'getConventions',
      invoke: (a) => a.getConventions('a/b?c'),
      method: 'GET',
      url: `${BASE}/repos/a%2Fb%3Fc/conventions`,
      reply: conventionsJson(),
    },
    {
      name: 'getBlastRadius',
      invoke: (a) => a.getBlastRadius('a/b?c'),
      method: 'GET',
      url: `${BASE}/pulls/a%2Fb%3Fc/blast`,
      reply: blastJson(),
    },
  ];

  for (const c of cases) {
    it(`${c.name} issues exactly ${c.method} ${c.url.replace(BASE, '')}`, async () => {
      const { api, calls } = recordingApi(() => jsonResponse(c.reply));
      await c.invoke(api);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe(c.method);
      expect(calls[0]!.url).toBe(c.url);
      if (c.body !== undefined) expect(JSON.parse(calls[0]!.body!)).toEqual(c.body);
    });
  }

  it('getBlastRadius keeps the map and keeps source_sha and drops cached/computed_at/index_status', async () => {
    const { api } = recordingApi(() => jsonResponse(blastJson()));
    const res = await api.getBlastRadius('p');
    expect(Object.keys(res).sort()).toEqual(['blast', 'head_sha', 'reason', 'source_sha', 'status', 'truncated']);
    expect(res.blast?.downstream[0]?.callers[0]?.line).toBe(42);
  });

  it('getBlastRadius maps an unparseable body to invalid_response', async () => {
    const { api } = recordingApi(() => jsonResponse({ status: 'weird' }));
    const e = await catchApiError(api.getBlastRadius('p'));
    expect(e.kind).toBe('invalid_response');
  });

  it('returns only the picked fields (agent loses system_prompt)', async () => {
    const { api } = recordingApi(() => jsonResponse([agentJson()]));
    const [agent] = await api.listAgents();
    expect(Object.keys(agent!).sort()).toEqual(['description', 'enabled', 'id', 'model', 'name']);
  });
});

describe('HttpDevDigestApi — failure mapping (AC-19, AC-20, AC-14)', () => {
  it('maps a rejected fetch (ECONNREFUSED) to unreachable', async () => {
    const { api } = recordingApi(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    const e = await catchApiError(api.listRepos());
    expect(e.kind).toBe('unreachable');
    expect(e.baseUrl).toBe(BASE);
    expect(e.endpoint).toBe('GET /repos');
    expect(isTransient(e)).toBe(true);
  });

  it('maps an aborted timeout signal to timeout', async () => {
    const api = new HttpDevDigestApi(BASE, 5, (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    );
    const e = await catchApiError(api.listRepos());
    expect(e.kind).toBe('timeout');
    expect(e.timeoutMs).toBe(5);
    expect(e.transient).toBe(true);
  });

  it('a caller abort cancels the in-flight fetch and rethrows the abort reason', async () => {
    const api = new HttpDevDigestApi(BASE, 60_000, (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    );
    const controller = new AbortController();
    const pending = api.listRuns('p', controller.signal);
    const reason = new Error('cancelled by client');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('keeps a 404 envelope code and message', async () => {
    const { api } = recordingApi(() =>
      jsonResponse({ error: { code: 'not_found', message: 'Repo not found' } }, 404),
    );
    const e = await catchApiError(api.getConventions('x'));
    expect(e.kind).toBe('http');
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('Repo not found');
    expect(e.endpoint).toBe('GET /repos/:id/conventions');
    expect(e.transient).toBe(false);
  });

  it('reads retry-after on a 429 and classifies it by status even with an internal_error code', async () => {
    const { api } = recordingApi(() =>
      jsonResponse(
        { error: { code: 'internal_error', message: 'Rate limit exceeded, retry in 1 minute' } },
        429,
        { 'retry-after': '17' },
      ),
    );
    const e = await catchApiError(api.startReview('p', 'a'));
    expect(e.kind).toBe('http');
    expect(e.status).toBe(429);
    expect(e.code).toBe('internal_error');
    expect(e.retryAfterSec).toBe(17);
    expect(e.transient).toBe(true);
  });

  it('ignores a non-numeric retry-after', async () => {
    const { api } = recordingApi(() =>
      jsonResponse({ error: { code: 'x', message: 'm' } }, 429, { 'retry-after': 'soon' }),
    );
    const e = await catchApiError(api.listRuns('p'));
    expect(e.retryAfterSec).toBeNull();
  });

  it('falls back to HTTP <status> without an envelope; 5xx is transient', async () => {
    const { api } = recordingApi(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const e = await catchApiError(api.listRuns('p'));
    expect(e.message).toBe('HTTP 502');
    expect(e.code).toBeNull();
    expect(e.transient).toBe(true);
  });

  it('keeps the first validation issue of a 422 as detail', async () => {
    const { api } = recordingApi(() =>
      jsonResponse(
        {
          error: {
            code: 'validation_error',
            message: 'Request validation failed',
            details: [{ path: ['agent_id'], message: 'Required' }, { path: ['x'], message: 'other' }],
          },
        },
        422,
      ),
    );
    const e = await catchApiError(api.listRuns('p'));
    expect(e.status).toBe(422);
    expect(e.detail).toBe('agent_id: Required');
  });

  it('maps a body that fails the picked schema to invalid_response with the issue path', async () => {
    const { api } = recordingApi(() => jsonResponse([{ id: 1 }]));
    const e = await catchApiError(api.listRepos());
    expect(e.kind).toBe('invalid_response');
    expect(e.endpoint).toBe('GET /repos');
    expect(e.issuePath).toBe('0.id');
  });
});

describe('picked schemas tolerate unrelated drift (AC-23b)', () => {
  it('parses a finding with an unknown kind and category', async () => {
    const review = reviewJson({ findings: [findingJson({ kind: 'brand_new_kind', category: 'docs' })] });
    const { api } = recordingApi(() => jsonResponse([review]));
    const [r] = await api.listReviews('p');
    expect(r!.findings[0]!.category).toBe('docs');
  });

  it('parses a candidate with an unknown origin', async () => {
    const page = conventionsJson({ candidates: [candidateJson({ origin: 'new_origin' })] });
    const { api } = recordingApi(() => jsonResponse(page));
    const c = await api.getConventions('r');
    expect(c.candidates).toHaveLength(1);
  });
});
