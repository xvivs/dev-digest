/**
 * Tool result builders. `toToolResult` is the single translation point from a
 * thrown value to an `isError` result with a next step (Error catalogue).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from './api/errors.js';
import { ToolError, quoteData } from './errors.js';

/** Success: compact JSON text plus the same object as `structuredContent` (D13). */
export function ok<T extends Record<string, unknown>>(structured: T): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
}

export type ErrorKind =
  | ToolError['kind']
  | 'api_unreachable'
  | 'api_timeout'
  | 'rate_limited'
  | 'api_error'
  | 'invalid_response';

export interface DescribedError {
  kind: ErrorKind;
  message: string;
  nextStep: string;
}

/** Default wait quoted when a 429 carries no usable `retry-after`. */
export const RATE_LIMIT_FALLBACK_SEC = 60;

function seconds(ms: number): string {
  return String(Number((ms / 1000).toFixed(3)));
}

function httpNextStep(status: number | null, code: string | null): string {
  if (status === 424 && code === 'config_error') {
    return 'A required key or token is not configured. Add it in DevDigest Settings, then retry.';
  }
  if (status !== null && status >= 400 && status < 500) {
    return 'Fix the request using the error above, then retry.';
  }
  return 'See the DevDigest API log.';
}

export function describeError(err: unknown): DescribedError {
  if (err instanceof ToolError) return { kind: err.kind, message: err.message, nextStep: err.nextStep };
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'unreachable':
        return {
          kind: 'api_unreachable',
          message: `DevDigest API is not reachable at ${err.baseUrl}.`,
          nextStep: 'Start it with ./scripts/dev.sh; check DEVDIGEST_API_URL.',
        };
      case 'timeout':
        return {
          kind: 'api_timeout',
          message: `DevDigest API did not answer within ${seconds(err.timeoutMs)} s.`,
          nextStep: 'Retry; if it keeps happening, check the API log.',
        };
      case 'invalid_response':
        return {
          kind: 'invalid_response',
          message: `DevDigest returned an unexpected ${err.endpoint} shape: ${err.issuePath ?? '(unknown)'}.`,
          nextStep: 'The mcp package and the API are out of sync; update both.',
        };
      case 'http':
        // 429 is classified by status: the API sends it as code internal_error (D10).
        if (err.status === 429) {
          return {
            kind: 'rate_limited',
            message: 'DevDigest rate limit hit.',
            nextStep: `Retry after ${err.retryAfterSec ?? RATE_LIMIT_FALLBACK_SEC} s.`,
          };
        }
        return {
          kind: 'api_error',
          message:
            `DevDigest API error on ${err.endpoint} (HTTP ${err.status ?? '?'}, code ${err.code ?? 'none'}): ` +
            `${quoteData(err.message)}.` +
            (err.status === 422 && err.detail ? ` First issue (data): ${quoteData(err.detail, 200)}.` : ''),
          nextStep: httpNextStep(err.status, err.code),
        };
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    kind: 'api_error',
    message: `devdigest-mcp hit an unexpected error: ${quoteData(message)}.`,
    nextStep: 'See the DevDigest API log.',
  };
}

export function toToolResult(err: unknown): CallToolResult {
  const d = describeError(err);
  return { isError: true, content: [{ type: 'text', text: `${d.message} Next step: ${d.nextStep}` }] };
}
