/**
 * Failure of one DevDigest API call. A leaf module: no imports, so every layer
 * may use it. The user-facing wording lives in `results.ts`; this class carries
 * only the facts the templates need.
 */
export type ApiErrorKind = 'unreachable' | 'http' | 'timeout' | 'invalid_response';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  baseUrl: string;
  /** Method + path template, e.g. `GET /pulls/:id/runs` (never the substituted id). */
  endpoint: string;
  timeoutMs: number;
  status?: number | null;
  code?: string | null;
  retryAfterSec?: number | null;
  issuePath?: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterSec: number | null;
  /** True for unreachable, timeout, 429 and 5xx. */
  readonly transient: boolean;
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly issuePath: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.retryAfterSec = init.retryAfterSec ?? null;
    this.baseUrl = init.baseUrl;
    this.endpoint = init.endpoint;
    this.timeoutMs = init.timeoutMs;
    this.issuePath = init.issuePath;
    this.transient =
      init.kind === 'unreachable' ||
      init.kind === 'timeout' ||
      (init.kind === 'http' && this.status !== null && (this.status === 429 || this.status >= 500));
  }
}

export function isTransient(e: unknown): boolean {
  return e instanceof ApiError && e.transient;
}
