/** ADR 0018: EVAL_MAX_BUDGET_USD parsing (hermetic). */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

const load = (v?: string) =>
  loadConfig({ NODE_ENV: 'test', ...(v !== undefined ? { EVAL_MAX_BUDGET_USD: v } : {}) } as NodeJS.ProcessEnv);

describe('EVAL_MAX_BUDGET_USD', () => {
  it('defaults to 5 when unset or empty (`.env` may ship `EVAL_MAX_BUDGET_USD=`)', () => {
    expect(load().evalMaxBudgetUsd).toBe(5);
    expect(load('').evalMaxBudgetUsd).toBe(5);
  });
  it('parses a positive number and refuses zero or negatives', () => {
    expect(load('0.75').evalMaxBudgetUsd).toBe(0.75);
    expect(() => load('0')).toThrow();
    expect(() => load('-1')).toThrow();
  });
});
