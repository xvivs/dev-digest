import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { MockLLMProvider } from '../src/adapters/mocks.js';

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
const aborted = () => {
  const ac = new AbortController();
  ac.abort();
  return ac.signal;
};

describe('LLM providers — signal / timeout on completeStructured', () => {
  beforeEach(() => {
    openaiCreate.mockReset();
    anthropicCreate.mockReset();
  });

  it('OpenAI: aborted signal rejects with AbortError, no SDK call', async () => {
    await expect(
      new OpenAIProvider('k').completeStructured({ ...base, signal: aborted() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it('Anthropic: aborted signal rejects with AbortError, no SDK call', async () => {
    await expect(
      new AnthropicProvider('k').completeStructured({ ...base, signal: aborted() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('OpenAI: no per-request options without timeoutMs/signal', async () => {
    openaiCreate.mockResolvedValue(openaiOk);
    await new OpenAIProvider('k').completeStructured(base);
    expect(openaiCreate.mock.calls[0]![1]).toBeUndefined();
  });

  it('Anthropic: no per-request options without timeoutMs/signal', async () => {
    anthropicCreate.mockResolvedValue(anthropicOk);
    await new AnthropicProvider('k').completeStructured(base);
    expect(anthropicCreate.mock.calls[0]![1]).toBeUndefined();
  });

  it('OpenAI / Anthropic: forward { timeout, maxRetries: 0, signal }', async () => {
    openaiCreate.mockResolvedValue(openaiOk);
    anthropicCreate.mockResolvedValue(anthropicOk);
    const signal = new AbortController().signal;
    await new OpenAIProvider('k').completeStructured({ ...base, timeoutMs: 777, signal });
    await new AnthropicProvider('k').completeStructured({ ...base, timeoutMs: 777, signal });
    const want = { timeout: 777, maxRetries: 0, signal };
    expect(openaiCreate.mock.calls[0]![1]).toEqual(want);
    expect(anthropicCreate.mock.calls[0]![1]).toEqual(want);
  });
});

describe('MockLLMProvider — signal', () => {
  it('throws AbortError when the signal is already aborted', async () => {
    const llm = new MockLLMProvider('openai', { structured: { ok: true } });
    await expect(llm.completeStructured({ ...base, signal: aborted() })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(llm.completeStructured(base)).resolves.toMatchObject({ data: { ok: true } });
  });
});
