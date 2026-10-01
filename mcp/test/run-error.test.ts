import { describe, expect, it } from 'vitest';
import { toolErrors } from '../src/errors.js';
import { classifyRunError, type RunErrorCategory } from '../src/run-error.js';

const CASES: Array<[RunErrorCategory, string | null, string | null, string]> = [
  ['cancelled', 'cancelled', null, 'cancelled by a user'],
  ['cancelled', 'failed', 'Cancelled by user', 'cancelled by a user'],
  ['cancelled', 'cancelled', 'OPENROUTER_API_KEY is not configured', 'cancelled by a user'],
  ['interrupted', 'failed', null, 'API restarted'],
  ['interrupted', 'failed', '', 'API restarted'],
  ['interrupted', 'failed', 'Interrupted by server restart', 'API restarted'],
  [
    'deadline',
    'failed',
    'Review LLM call for "all files" exceeded the 900 s deadline and was aborted',
    'REVIEW_CALL_DEADLINE_MS',
  ],
  ['llm_key', 'failed', 'OPENROUTER_API_KEY is not configured', 'LLM provider key'],
  ['llm_key', 'failed', 'HTTP 401 Unauthorized', 'LLM provider key'],
  ['billing', 'failed', '402 Insufficient credits', 'billing/quota'],
  ['rate_limited', 'failed', 'HTTP 429 Too Many Requests', 'rate-limiting'],
  ['truncated', 'failed', 'Model output cut at max_tokens (finish_reason=length, 8192 tokens)', 'larger output limit'],
  ['bad_output', 'failed', 'OpenRouter structured output failed schema validation for Review', 'unusable answer'],
  ['setup', 'failed', 'Failed to load PR diff', 'before the model call'],
  ['setup', 'failed', 'Failed to load PR diff: GitHub responded 401', 'before the model call'],
  ['unknown', 'failed', 'processed 4290 lines', 'DevDigest API log'],
  ['llm_key', 'failed', 'LLM key invalid', 'LLM provider key'],
  ['unknown', 'failed', 'something odd happened', 'DevDigest API log'],
];

describe('classifyRunError', () => {
  for (const [category, status, error, hint] of CASES) {
    it(`${category}: ${status} / ${JSON.stringify(error)}`, () => {
      const c = classifyRunError(status, error);
      expect(c.category).toBe(category);
      expect(c.nextStep).toContain(hint);
    });
  }

  it('is case-insensitive', () => {
    expect(classifyRunError('failed', 'RATE LIMIT hit').category).toBe('rate_limited');
  });

  it('status wins over the key text, and the deadline wins over later rules', () => {
    expect(classifyRunError('failed', 'exceeded the 5 s deadline; 429').category).toBe('deadline');
  });
});

describe('toolErrors.runFailed', () => {
  it('stays run_failed and uses the classified next step', () => {
    const e = toolErrors.runFailed('r1', 'failed', 'Review LLM call exceeded the 900 s deadline');
    expect(e.kind).toBe('run_failed');
    expect(e.nextStep).toContain('REVIEW_CALL_DEADLINE_MS');
    expect(e.message).toContain('Run error (data):');
  });
});
