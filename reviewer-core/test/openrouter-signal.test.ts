import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { sdkRequestOptions } from '../src/llm/request-options.js';

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

describe('sdkRequestOptions', () => {
  it('is undefined without timeoutMs/signal', () => {
    expect(sdkRequestOptions({})).toBeUndefined();
  });
  it('disables SDK retries and forwards timeout + signal', () => {
    const signal = new AbortController().signal;
    expect(sdkRequestOptions({ timeoutMs: 5, signal })).toEqual({ timeout: 5, maxRetries: 0, signal });
    expect(sdkRequestOptions({ timeoutMs: 5 })).toEqual({ timeout: 5, maxRetries: 0 });
  });
});

describe('OpenRouterProvider.completeStructured — signal / timeout', () => {
  beforeEach(() => create.mockReset());

  it('rejects with AbortError and makes no SDK call when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const p = new OpenRouterProvider('k');
    await expect(p.completeStructured({ ...base, signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('checks the signal before each repair attempt', async () => {
    const ac = new AbortController();
    create.mockImplementationOnce(async () => {
      ac.abort();
      return { choices: [{ message: { content: 'not json' } }], usage: {} };
    });
    const p = new OpenRouterProvider('k');
    await expect(p.completeStructured({ ...base, signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('passes no per-request options without timeoutMs/signal', async () => {
    create.mockResolvedValue(okResponse);
    await new OpenRouterProvider('k').completeStructured(base);
    expect(create.mock.calls[0]![1]).toBeUndefined();
  });

  it('passes { timeout, maxRetries: 0, signal } when set', async () => {
    create.mockResolvedValue(okResponse);
    const signal = new AbortController().signal;
    await new OpenRouterProvider('k').completeStructured({ ...base, timeoutMs: 1234, signal });
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 1234, maxRetries: 0, signal });
  });
});
