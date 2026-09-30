import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { withTransientRetry, isTransientLlmError, retryAfterMs } from '../src/llm/retry.js';

const schema = z.object({ ok: z.boolean() });
const base = {
  model: 'm',
  schema,
  schemaName: 'T',
  messages: [{ role: 'user' as const, content: 'hi' }],
};
const okResponse = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};
const httpError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, headers });
const noJitter = () => 0;

describe('isTransientLlmError / retryAfterMs', () => {
  it('classifies 429 / 5xx / network codes as transient, 4xx and aborts as not', () => {
    expect(isTransientLlmError(httpError(429))).toBe(true);
    expect(isTransientLlmError(httpError(503))).toBe(true);
    expect(isTransientLlmError(httpError(400))).toBe(false);
    expect(isTransientLlmError(httpError(401))).toBe(false);
    expect(isTransientLlmError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientLlmError(new Error('Connection error.', { cause: Object.assign(new Error('r'), { code: 'ETIMEDOUT' }) }))).toBe(true);
    expect(isTransientLlmError(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isTransientLlmError(new Error('failed schema validation'))).toBe(false);
  });

  it('reads Retry-After as seconds, HTTP date, or retry-after-ms (record or Headers)', () => {
    expect(retryAfterMs(httpError(429, { 'retry-after': '2' }))).toBe(2000);
    expect(retryAfterMs(httpError(429, { 'retry-after-ms': '750' }))).toBe(750);
    expect(retryAfterMs(httpError(429, { 'retry-after': new Date(10_000).toUTCString() }), 7_000)).toBe(3000);
    expect(retryAfterMs(Object.assign(new Error('x'), { headers: new Headers({ 'retry-after': '1' }) }))).toBe(1000);
    expect(retryAfterMs(httpError(429))).toBeUndefined();
  });
});

describe('withTransientRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('5xx then success: retries after the 500 ms backoff', async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce('ok');
    const p = withTransientRetry(fn, { random: noJitter });
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('backs off 500 → 1500 and gives up after 2 retries with the last error', async () => {
    const err = httpError(500);
    const fn = vi.fn().mockRejectedValue(err);
    const p = withTransientRetry(fn, { random: noJitter });
    const settled = expect(p).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('429 honours Retry-After over the computed backoff', async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(429, { 'retry-after': '3' })).mockResolvedValueOnce('ok');
    const p = withTransientRetry(fn, { random: noJitter });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('ok');
  });

  it('abort during backoff rejects with AbortError and makes no new attempt', async () => {
    const ac = new AbortController();
    const fn = vi.fn().mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce('ok');
    const p = withTransientRetry(fn, { signal: ac.signal, random: noJitter });
    const settled = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(200);
    ac.abort();
    await settled;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('remaining deadline shorter than the backoff: no retry, original error', async () => {
    const err = httpError(503);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn, { deadlineAt: Date.now() + 300, random: noJitter })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Retry-After beyond the deadline: no retry', async () => {
    const err = httpError(429, { 'retry-after': '10' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn, { deadlineAt: Date.now() + 5000 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('400 fails at once', async () => {
    const err = httpError(400);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('AbortError from the call is not retried', async () => {
    const fn = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(withTransientRetry(fn)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('OpenRouterProvider — transient retry with signal/timeoutMs', () => {
  beforeEach(() => {
    create.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('5xx → success on the second attempt, still maxRetries: 0 on the SDK', async () => {
    create.mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce(okResponse);
    const signal = new AbortController().signal;
    const p = new OpenRouterProvider('k').completeStructured({ ...base, timeoutMs: 60_000, signal });
    await vi.advanceTimersByTimeAsync(700);
    await expect(p).resolves.toMatchObject({ data: { ok: true }, attempts: 1 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toMatchObject({ maxRetries: 0, signal });
  });

  it('timeoutMs shorter than the backoff: the original 503 surfaces, one call', async () => {
    create.mockRejectedValue(httpError(503));
    await expect(new OpenRouterProvider('k').completeStructured({ ...base, timeoutMs: 200 })).rejects.toMatchObject({
      status: 503,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('finish_reason=length is not retried', async () => {
    create.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: null } }], usage: {} });
    await expect(
      new OpenRouterProvider('k').completeStructured({ ...base, timeoutMs: 60_000 }),
    ).rejects.toThrow(/finish_reason=length/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('without signal/timeoutMs the helper is not used (SDK owns retries)', async () => {
    create.mockRejectedValueOnce(httpError(503));
    await expect(new OpenRouterProvider('k').completeStructured(base)).rejects.toMatchObject({ status: 503 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
