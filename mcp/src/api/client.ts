/**
 * The permission boundary (D7): the seven DevDigest API calls a tool can make.
 * There is deliberately no generic `request(method, path)` export; adding an
 * endpoint means adding a method here and a test in `test/api-client.test.ts`.
 * This file is the only `fetch` caller in the package.
 */
import { z } from 'zod';
import { ApiError } from './errors.js';
import {
  AgentLite,
  ConventionsLite,
  PrLite,
  RepoLite,
  ReviewLite,
  RunLite,
  StartReviewLite,
} from './schemas.js';

export interface DevDigestApi {
  listRepos(): Promise<RepoLite[]>;
  listPulls(repoId: string): Promise<PrLite[]>;
  listAgents(): Promise<AgentLite[]>;
  startReview(prId: string, agentId: string): Promise<StartReviewLite>;
  /** `signal` (the tool call's abort signal) cancels the in-flight request too. */
  listRuns(prId: string, signal?: AbortSignal): Promise<RunLite[]>;
  listReviews(prId: string, signal?: AbortSignal): Promise<ReviewLite[]>;
  getConventions(repoId: string): Promise<ConventionsLite>;
}

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

const ErrorEnvelope = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(),
});

const id = (value: string): string => encodeURIComponent(value);

/** `retry-after` in whole seconds; an HTTP date or garbage gives null. */
function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\s*\d+\s*$/.test(header)) return null;
  return Number.parseInt(header, 10);
}

export class HttpDevDigestApi implements DevDigestApi {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchImpl;

  constructor(baseUrl: string, httpTimeoutMs: number, fetchImpl: FetchImpl = fetch) {
    this.#baseUrl = baseUrl;
    this.#timeoutMs = httpTimeoutMs;
    this.#fetch = fetchImpl;
  }

  listRepos(): Promise<RepoLite[]> {
    return this.#get('GET /repos', '/repos', z.array(RepoLite));
  }

  listPulls(repoId: string): Promise<PrLite[]> {
    return this.#get('GET /repos/:id/pulls', `/repos/${id(repoId)}/pulls`, z.array(PrLite));
  }

  listAgents(): Promise<AgentLite[]> {
    return this.#get('GET /agents', '/agents', z.array(AgentLite));
  }

  startReview(prId: string, agentId: string): Promise<StartReviewLite> {
    return this.#post(
      'POST /pulls/:id/review',
      `/pulls/${id(prId)}/review`,
      { agentId },
      StartReviewLite,
    );
  }

  listRuns(prId: string, signal?: AbortSignal): Promise<RunLite[]> {
    return this.#get('GET /pulls/:id/runs', `/pulls/${id(prId)}/runs`, z.array(RunLite), signal);
  }

  listReviews(prId: string, signal?: AbortSignal): Promise<ReviewLite[]> {
    return this.#get('GET /pulls/:id/reviews', `/pulls/${id(prId)}/reviews`, z.array(ReviewLite), signal);
  }

  getConventions(repoId: string): Promise<ConventionsLite> {
    return this.#get(
      'GET /repos/:id/conventions',
      `/repos/${id(repoId)}/conventions`,
      ConventionsLite,
    );
  }

  #get<T>(
    endpoint: string,
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.#send(endpoint, path, { method: 'GET' }, schema, signal);
  }

  #post<T>(
    endpoint: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    return this.#send(
      endpoint,
      path,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      schema,
    );
  }

  async #send<T>(
    endpoint: string,
    path: string,
    init: RequestInit,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const base = { baseUrl: this.#baseUrl, endpoint, timeoutMs: this.#timeoutMs };
    const url = new URL(path, this.#baseUrl);

    let res: Response;
    try {
      res = await this.#fetch(url, {
        ...init,
        headers: { accept: 'application/json', ...(init.headers ?? {}) },
        signal: callerSignal
          ? AbortSignal.any([AbortSignal.timeout(this.#timeoutMs), callerSignal])
          : AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      // The caller cancelled (tool call aborted): not an API failure, rethrow as is.
      if (callerSignal?.aborted) throw callerSignal.reason;
      const name = (err as { name?: unknown } | null)?.name;
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      throw new ApiError({
        ...base,
        kind: timedOut ? 'timeout' : 'unreachable',
        message: timedOut ? `timed out after ${this.#timeoutMs} ms` : String((err as Error)?.message ?? err),
      });
    }

    let json: unknown;
    let jsonOk = true;
    try {
      const text = await res.text();
      json = text === '' ? undefined : JSON.parse(text);
    } catch (err) {
      if (callerSignal?.aborted) throw callerSignal.reason;
      const name = (err as { name?: unknown } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ApiError({ ...base, kind: 'timeout', message: `timed out after ${this.#timeoutMs} ms` });
      }
      jsonOk = false;
    }

    if (!res.ok) {
      const envelope = jsonOk ? ErrorEnvelope.safeParse(json) : undefined;
      const err = envelope?.success ? envelope.data.error : undefined;
      throw new ApiError({
        ...base,
        kind: 'http',
        status: res.status,
        code: err?.code ?? null,
        message: err?.message ?? `HTTP ${res.status}`,
        retryAfterSec: parseRetryAfter(res.headers.get('retry-after')),
      });
    }

    if (!jsonOk) {
      throw new ApiError({ ...base, kind: 'invalid_response', message: 'body is not JSON', issuePath: '(body)' });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const issuePath = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
      throw new ApiError({
        ...base,
        kind: 'invalid_response',
        message: issue?.message ?? 'schema mismatch',
        issuePath,
      });
    }
    return parsed.data;
  }
}
