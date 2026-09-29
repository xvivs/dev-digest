import { describe, it, expect } from 'vitest';
import { CANDIDATE_FIELD_ORDER, ConventionExtraction, ProposedCandidateSchema } from './llm-schema.js';

describe('ConventionExtraction schema', () => {
  it('declares candidate fields in generation order (AC-13, G2)', () => {
    expect(Object.keys(ProposedCandidateSchema.shape)).toEqual([...CANDIDATE_FIELD_ORDER]);
    expect(CANDIDATE_FIELD_ORDER).toEqual([
      'rule',
      'evidence',
      'counter_example',
      'origin',
      'signal_id',
      'prior_ref',
      'category',
      'llm_confidence',
    ]);
  });

  const quote = { path: 'src/a.ts', quote: 'export const x = 1;', line_hint: 1 };
  const cand = {
    rule: 'Use named exports only',
    evidence: [quote],
    counter_example: null,
    origin: 'code',
    signal_id: null,
    prior_ref: null,
    category: 'imports',
    llm_confidence: 0.7,
  };

  it('accepts an empty list', () => {
    expect(ConventionExtraction.safeParse({ candidates: [] }).success).toBe(true);
  });

  it('bounds candidates, quotes, quote length and prior_ref shape', () => {
    expect(ConventionExtraction.safeParse({ candidates: Array(13).fill(cand) }).success).toBe(false);
    expect(ConventionExtraction.safeParse({ candidates: [{ ...cand, evidence: [] }] }).success).toBe(false);
    expect(ConventionExtraction.safeParse({ candidates: [{ ...cand, evidence: Array(4).fill(quote) }] }).success).toBe(false);
    expect(
      ConventionExtraction.safeParse({ candidates: [{ ...cand, evidence: [{ ...quote, quote: 'x'.repeat(241) }] }] }).success,
    ).toBe(false);
    expect(ConventionExtraction.safeParse({ candidates: [{ ...cand, prior_ref: 'X1' }] }).success).toBe(false);
    expect(ConventionExtraction.safeParse({ candidates: [{ ...cand, category: 'style' }] }).success).toBe(false);
    expect(ConventionExtraction.safeParse({ candidates: [cand] }).success).toBe(true);
  });
});
