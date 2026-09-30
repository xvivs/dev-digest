import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { OpenRouterProvider, toProviderBody } from '../src/llm/openrouter.js';
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

describe('OpenRouterProvider.completeStructured — response format / reasoning / truncation', () => {
  beforeEach(() => create.mockReset());

  it('sends strict json_schema and no reasoning field by default', async () => {
    create.mockResolvedValue(okResponse);
    await new OpenRouterProvider('k').completeStructured(base);
    const body = create.mock.calls[0]![0];
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'T', strict: true } });
    expect(body).not.toHaveProperty('reasoning');
  });

  it('sends JSON mode and disables reasoning when asked', async () => {
    create.mockResolvedValue(okResponse);
    await new OpenRouterProvider('k').completeStructured({ ...base, responseFormat: 'json_object', disableReasoning: true });
    const body = create.mock.calls[0]![0];
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it('sends no provider field without providerRouting', async () => {
    create.mockResolvedValue(okResponse);
    await new OpenRouterProvider('k').completeStructured(base);
    expect(create.mock.calls[0]![0]).not.toHaveProperty('provider');
  });

  it('maps providerRouting to the snake_case provider body field', async () => {
    create.mockResolvedValue(okResponse);
    await new OpenRouterProvider('k').completeStructured({
      ...base,
      providerRouting: { sort: 'throughput', ignore: ['deepinfra'], only: ['alibaba'], allowFallbacks: false },
    });
    expect(create.mock.calls[0]![0].provider).toEqual({
      sort: 'throughput',
      ignore: ['deepinfra'],
      only: ['alibaba'],
      allow_fallbacks: false,
    });
  });

  it('never sends provider routing to the plain OpenAI endpoint', async () => {
    create.mockResolvedValue(okResponse);
    await new OpenRouterProvider('k', { id: 'openai' }).completeStructured({ ...base, providerRouting: { sort: 'price' } });
    expect(create.mock.calls[0]![0]).not.toHaveProperty('provider');
  });

  it('toProviderBody omits unset and empty fields', () => {
    expect(toProviderBody({})).toEqual({});
    expect(toProviderBody({ ignore: [], only: [] })).toEqual({});
    expect(toProviderBody({ allowFallbacks: true })).toEqual({ allow_fallbacks: true });
  });

  it('fails at once on finish_reason=length instead of spending a repair attempt', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 6000 },
    });
    await expect(new OpenRouterProvider('k').completeStructured({ ...base, maxRetries: 1 })).rejects.toThrow(
      /finish_reason=length, 6000 output tokens/,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('OpenRouterProvider — the request body a review sends', () => {
  beforeEach(() => create.mockReset());

  it('carries reasoning off, provider routing, explicit temperature and the per-request signal', async () => {
    create.mockResolvedValue(okResponse);
    const signal = new AbortController().signal;
    await new OpenRouterProvider('k').completeStructured({
      ...base,
      temperature: 0,
      timeoutMs: 120_000,
      signal,
      disableReasoning: true,
      providerRouting: { sort: 'throughput', allowFallbacks: true },
    });
    const [body, opts] = create.mock.calls[0]!;
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.provider).toEqual({ sort: 'throughput', allow_fallbacks: true });
    expect(body.temperature).toBe(0);
    expect(opts).toEqual({ timeout: 120_000, maxRetries: 0, signal });
  });
});
