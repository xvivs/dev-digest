import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest, ReviewDeadlineError, DEFAULT_REVIEW_CALL_DEADLINE_MS } from '../src/index.js';

/**
 * A provider whose call never returns on its own — it only settles when the
 * request's signal aborts, the way a stalled OpenRouter body behaves once the
 * SDK has its signal. Records the requests it saw.
 */
function stalledProvider(): LLMProvider & { reqs: StructuredRequest<unknown>[]; entered: Promise<void> } {
  let enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const reqs: StructuredRequest<unknown>[] = [];
  return {
    id: 'openai',
    reqs,
    entered,
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      reqs.push(req as StructuredRequest<unknown>);
      enter();
      return new Promise<StructuredResult<T>>((_, reject) => {
        const onAbort = () => reject(new DOMException('The user aborted a request.', 'AbortError'));
        if (req.signal?.aborted) onAbort();
        req.signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    async complete() {
      throw new Error('unused');
    },
    async embed() {
      throw new Error('unused');
    },
    async listModels() {
      return [];
    },
  };
}

const base = { systemPrompt: 's', model: 'm' };

describe('reviewPullRequest — per-call deadline and caller abort', () => {
  it('aborts a stalled call at the deadline and names it (ReviewDeadlineError)', async () => {
    const llm = stalledProvider();
    const diff = await new MockGitClient().diff();
    const started = Date.now();
    const err = await reviewPullRequest({ ...base, diff, llm, callDeadlineMs: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDeadlineError);
    expect((err as ReviewDeadlineError).chunk).toBe('all files');
    expect(Date.now() - started).toBeLessThan(2_000);
    // the request itself was aborted (socket closed), not merely abandoned
    expect(llm.reqs[0]!.signal?.aborted).toBe(true);
  });

  it('caller abort mid-flight rejects with the AbortError, not a deadline error', async () => {
    const llm = stalledProvider();
    const diff = await new MockGitClient().diff();
    const ac = new AbortController();
    const p = reviewPullRequest({ ...base, diff, llm, signal: ac.signal }).catch((e: unknown) => e);
    await llm.entered;
    ac.abort();
    const err = await p;
    expect(err).not.toBeInstanceOf(ReviewDeadlineError);
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(llm.reqs[0]!.signal?.aborted).toBe(true);
  });

  it('an already-aborted caller signal makes no successful call', async () => {
    const llm = new MockLLMProvider('openai', { structured: { verdict: 'approve', summary: '', score: 1, findings: [] } });
    const diff = await new MockGitClient().diff();
    const ac = new AbortController();
    ac.abort();
    await expect(reviewPullRequest({ ...base, diff, llm, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('forwards temperature 0, timeoutMs, a signal and the OpenRouter tuning on every chunk call', async () => {
    const llm = new MockLLMProvider('openai', { structured: { verdict: 'approve', summary: '', score: 1, findings: [] } });
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({
      ...base,
      diff,
      llm,
      disableReasoning: true,
      providerRouting: { sort: 'throughput', allowFallbacks: true },
    });
    const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as StructuredRequest<unknown>;
    expect(req.temperature).toBe(0);
    expect(req.timeoutMs).toBe(DEFAULT_REVIEW_CALL_DEADLINE_MS);
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(req.disableReasoning).toBe(true);
    expect(req.providerRouting).toEqual({ sort: 'throughput', allowFallbacks: true });
  });

  it('omits reasoning / routing when the caller does not ask for them', async () => {
    const llm = new MockLLMProvider('openai', { structured: { verdict: 'approve', summary: '', score: 1, findings: [] } });
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ ...base, diff, llm });
    const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as StructuredRequest<unknown>;
    expect(req).not.toHaveProperty('disableReasoning');
    expect(req).not.toHaveProperty('providerRouting');
  });
});
