import { describe, it, expect } from 'vitest';
import type { SkillSource } from '@devdigest/shared';
import { applySourcePolicy, SkillBody, SkillName } from './skill-rules.js';
import { sha256Hex } from './hash.js';

describe('applySourcePolicy', () => {
  const body = 'Use named exports.';

  it.each([true, false])('manual is trusted regardless of requested enabled=%s', (req) => {
    expect(applySourcePolicy('manual', body, req)).toEqual({
      enabled: true,
      needsVetting: false,
      vettedBodyHash: null,
    });
  });

  it.each<SkillSource>(['imported', 'imported_url', 'community'])(
    '%s is forced disabled + needs vetting even when enabled is requested',
    (source) => {
      expect(applySourcePolicy(source, body, true)).toEqual({
        enabled: false,
        needsVetting: true,
        vettedBodyHash: null,
      });
    },
  );

  it.each([true, false])('extracted is auto-vetted with sha256(body), enabled=%s honoured', (req) => {
    expect(applySourcePolicy('extracted', body, req)).toEqual({
      enabled: req,
      needsVetting: false,
      vettedBodyHash: sha256Hex(body),
    });
  });

  it('hashes the UTF-8 bytes (known vector)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('shared skill field schemas', () => {
  it('rejects a bad name and invisible characters in the body', () => {
    expect(SkillName.safeParse('Bad Name').success).toBe(false);
    expect(SkillName.safeParse('good-name').success).toBe(true);
    expect(SkillBody.safeParse('hi​there').success).toBe(false);
    expect(SkillBody.safeParse('ok').success).toBe(true);
  });
});
