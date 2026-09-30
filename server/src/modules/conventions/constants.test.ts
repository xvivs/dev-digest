import { describe, it, expect } from 'vitest';
import {
  CONVENTIONS_PROVIDER_ROUTING,
  MAX_CANDIDATES,
  MAX_OBSERVED_PATTERNS,
  SCAN_DEADLINE_MS,
} from './constants.js';

describe('conventions constants (specs/02-conventions.md, Non-functional)', () => {
  it('keeps the PROPOSE output small enough for the 100 s deadline', () => {
    expect(SCAN_DEADLINE_MS).toBe(100_000);
    expect(MAX_CANDIDATES).toBe(8);
    expect(MAX_OBSERVED_PATTERNS).toBeLessThanOrEqual(5);
  });

  it('routes to the fastest OpenRouter upstream, skips the ones that returned [], keeps fallbacks', () => {
    expect(CONVENTIONS_PROVIDER_ROUTING).toEqual({
      sort: 'throughput',
      ignore: ['deepinfra', 'digitalocean'],
      allowFallbacks: true,
    });
    // `only` would pin one upstream: an outage there would fail every scan.
    expect(CONVENTIONS_PROVIDER_ROUTING.only).toBeUndefined();
  });
});
