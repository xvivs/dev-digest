/**
 * estimateTokens — rough ceil(chars / 4) estimate (SPEC-02 D4). Pins fixed
 * inputs against hand-computed expected values so a formula change is caught.
 */
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../src/skills.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('ceils an exact multiple of 4 with no extra rounding (ASCII)', () => {
    expect('test'.length).toBe(4);
    expect(estimateTokens('test')).toBe(1); // ceil(4 / 4) = 1
  });

  it('rounds a short ASCII string up to the next whole token', () => {
    expect('hello'.length).toBe(5);
    expect(estimateTokens('hello')).toBe(2); // ceil(5 / 4) = 2
  });

  it('undercounts a Cyrillic string the same way as ASCII (chars, not bytes)', () => {
    const text = 'тестування'; // 10 chars, all in the BMP (1 UTF-16 code unit each)
    expect(text.length).toBe(10);
    expect(estimateTokens(text)).toBe(3); // ceil(10 / 4) = 3
  });

  it('undercounts a CJK string the same way as ASCII (chars, not bytes)', () => {
    const text = 'こんにちは'; // 5 chars, all in the BMP (1 UTF-16 code unit each)
    expect(text.length).toBe(5);
    expect(estimateTokens(text)).toBe(2); // ceil(5 / 4) = 2
  });
});
