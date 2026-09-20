import { describe, it, expect } from 'vitest';
import type { CostSource, LLMProvider, StructuredResult, UnifiedDiff } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          costSource: 'provider',
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});

describe('reviewPullRequest cost-provenance fold (map-reduce, "weakest claim wins")', () => {
  // Two files force map-reduce (strategy: 'map-reduce' + files.length > 1) —
  // two completeStructured calls, one cost pair per chunk to fold.
  const TWO_FILE_DIFF: UnifiedDiff = {
    raw:
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ a/a.ts\n@@ -1,1 +1,1 @@\n+x\n' +
      'diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,1 @@\n+y',
    files: [
      { path: 'a.ts', additions: 1, deletions: 0, hunks: [] },
      { path: 'b.ts', additions: 1, deletions: 0, hunks: [] },
    ],
  };
  const EMPTY_REVIEW = { verdict: 'approve' as const, summary: 'ok', score: 100, findings: [] };

  /** An LLMProvider that returns the next queued (costUsd, costSource) pair per call. */
  function queuedCostProvider(
    pairs: { costUsd: number | null; costSource: CostSource | null }[],
  ): LLMProvider {
    let i = 0;
    return {
      id: 'openai',
      async completeStructured<T>(): Promise<StructuredResult<T>> {
        const pair = pairs[i++]!;
        return {
          data: EMPTY_REVIEW as unknown as T,
          model: 'm',
          tokensIn: 10,
          tokensOut: 5,
          costUsd: pair.costUsd,
          costSource: pair.costSource,
          raw: '{}',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
  }

  it('all chunks provider-sourced → summed cost stays provider', async () => {
    const llm = queuedCostProvider([
      { costUsd: 0.01, costSource: 'provider' },
      { costUsd: 0.02, costSource: 'provider' },
    ]);
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: TWO_FILE_DIFF,
      llm,
      strategy: 'map-reduce',
    });
    expect(outcome.mode).toBe('map-reduce');
    expect(outcome.costUsd).toBeCloseTo(0.03, 10);
    expect(outcome.costSource).toBe('provider');
  });

  it('a mix of provider and estimated chunks downgrades the sum to estimated', async () => {
    const llm = queuedCostProvider([
      { costUsd: 0.01, costSource: 'provider' },
      { costUsd: 0.02, costSource: 'estimated' },
    ]);
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: TWO_FILE_DIFF,
      llm,
      strategy: 'map-reduce',
    });
    expect(outcome.costUsd).toBeCloseTo(0.03, 10);
    expect(outcome.costSource).toBe('estimated');
  });

  it('any chunk missing a cost makes the whole sum unknown (both null)', async () => {
    const llm = queuedCostProvider([
      { costUsd: 0.01, costSource: 'provider' },
      { costUsd: null, costSource: null },
    ]);
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: TWO_FILE_DIFF,
      llm,
      strategy: 'map-reduce',
    });
    expect(outcome.costUsd).toBeNull();
    expect(outcome.costSource).toBeNull();
  });
});
