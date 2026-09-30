/**
 * Hermetic: `failureTrace` builds the minimal RunTrace persisted on a failed /
 * cancelled / pre-work-failed run. Pure — no DB, no bus.
 */
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '@devdigest/reviewer-core';
import { failureTrace } from '../src/modules/reviews/failure-trace.js';

const agent = { name: 'sec', version: 3, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'Review.' };
const log = [{ t: '00:00:01', kind: 'error' as const, msg: 'Run failed: boom' }];

describe('failureTrace', () => {
  it('fills config/stats from the agent and marks the cost missing as failed', () => {
    const trace = failureTrace({ agent, prNumber: 7, grounding: '0/0 passed', durationMs: 42, log });
    expect(trace.config).toEqual({
      agent: 'sec',
      version: '3',
      provider: 'openai',
      model: 'gpt-4.1',
      pr: 7,
      source: 'local',
    });
    expect(trace.stats).toEqual({
      duration_ms: 42,
      tokens_in: 0,
      tokens_out: 0,
      findings: 0,
      grounding: '0/0 passed',
      cost_usd: null,
      cost_source: null,
      cost_missing_reason: 'failed',
    });
    expect(trace.prompt_assembly.system).toBe('Review.');
    expect(trace.log).toBe(log);
    expect(trace.tool_calls).toEqual([]);
    expect(trace.raw_output).toBe('');
  });

  it('defaults duration to 0 and tolerates a nullable agent (orphaned run)', () => {
    const trace = failureTrace({
      agent: { name: 'unknown agent', version: null, provider: null, model: null, systemPrompt: null },
      prNumber: null,
      grounding: '0/0 passed',
      log: [],
    });
    expect(trace.config.version).toBeNull();
    expect(trace.config.model).toBe('');
    expect(trace.config.pr).toBeNull();
    expect(trace.stats.duration_ms).toBe(0);
    expect(trace.prompt_assembly.system).toBe('');
  });

  it('snapshots resolved skills with per-skill and total token estimates', () => {
    const skills = [
      { id: 's1', name: 'a', version: 1, body: 'alpha body text', sha256: 'h1' },
      { id: 's2', name: 'b', version: 2, body: 'beta', sha256: 'h2' },
    ];
    const trace = failureTrace({ agent, prNumber: 1, grounding: '0/0 passed', resolvedSkills: skills, log });
    expect(trace.prompt_assembly.skills_used).toEqual([
      { id: 's1', name: 'a', version: 1, sha256: 'h1', tokens: estimateTokens('alpha body text') },
      { id: 's2', name: 'b', version: 2, sha256: 'h2', tokens: estimateTokens('beta') },
    ]);
    expect(trace.prompt_assembly.skills_tokens).toBe(estimateTokens('alpha body text') + estimateTokens('beta'));
  });

  it('leaves skills_used / skills_tokens null when resolution never happened or found none', () => {
    for (const resolvedSkills of [undefined, []]) {
      const trace = failureTrace({
        agent,
        prNumber: 1,
        grounding: '0/0 passed',
        ...(resolvedSkills ? { resolvedSkills } : {}),
        log,
      });
      expect(trace.prompt_assembly.skills_used).toBeNull();
      expect(trace.prompt_assembly.skills_tokens).toBeNull();
    }
  });
});
