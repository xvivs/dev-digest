import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const openaiCreate = vi.fn();
const anthropicCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));

import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';

const schema = z.object({ ok: z.boolean() });
const base = {
  model: 'gpt-4.1',
  schema,
  schemaName: 'T',
  messages: [{ role: 'user' as const, content: 'hi' }],
};
const openaiOk = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};
const anthropicOk = {
  content: [{ type: 'tool_use', input: { ok: true } }],
  usage: { input_tokens: 1, output_tokens: 1 },
};
const httpError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, headers });

const cases = [
  { name: 'OpenAI', create: openaiCreate, ok: openaiOk, make: () => new OpenAIProvider('k') },
  { name: 'Anthropic', create: anthropicCreate, ok: anthropicOk, make: () => new AnthropicProvider('k') },
] as const;

describe.each(cases)('$name adapter — deadline-aware transient retry', ({ create, ok, make }) => {
  beforeEach(() => {
    create.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('5xx → success on the second attempt', async () => {
    create.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(ok);
    const p = make().completeStructured({ ...base, timeoutMs: 60_000, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(700);
    await expect(p).resolves.toMatchObject({ data: { ok: true } });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('429 waits for Retry-After', async () => {
    create.mockRejectedValueOnce(httpError(429, { 'retry-after': '2' })).mockResolvedValueOnce(ok);
    const p = make().completeStructured({ ...base, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toMatchObject({ data: { ok: true } });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('abort during backoff → AbortError, no new attempt', async () => {
    const ac = new AbortController();
    create.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(ok);
    const p = make().completeStructured({ ...base, timeoutMs: 60_000, signal: ac.signal });
    const settled = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    ac.abort();
    await settled;
    await vi.advanceTimersByTimeAsync(5000);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('deadline shorter than the backoff → original error, no retry', async () => {
    create.mockRejectedValue(httpError(502));
    await expect(make().completeStructured({ ...base, timeoutMs: 300 })).rejects.toMatchObject({ status: 502 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('400 → fails at once', async () => {
    create.mockRejectedValue(httpError(400));
    await expect(
      make().completeStructured({ ...base, timeoutMs: 60_000, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ status: 400 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
