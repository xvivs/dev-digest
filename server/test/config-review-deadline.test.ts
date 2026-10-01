/** REVIEW_CALL_DEADLINE_MS parsing (hermetic). */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

const load = (v?: string) =>
  loadConfig({ NODE_ENV: 'test', ...(v !== undefined ? { REVIEW_CALL_DEADLINE_MS: v } : {}) } as NodeJS.ProcessEnv);

describe('REVIEW_CALL_DEADLINE_MS', () => {
  it('defaults to 900000 when unset or empty', () => {
    expect(load().reviewCallDeadlineMs).toBe(900_000);
    expect(load('').reviewCallDeadlineMs).toBe(900_000);
  });
  it('parses a positive integer and refuses zero, negatives, fractions and junk', () => {
    expect(load('60000').reviewCallDeadlineMs).toBe(60_000);
    for (const bad of ['0', '-1', '1.5', 'abc']) expect(() => load(bad)).toThrow();
  });
});
