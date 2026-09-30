import { describe, it, expect } from 'vitest';
import { toJsonSchema } from '../../../../reviewer-core/src/llm/structured.js';
import { MAX_CANDIDATES } from './constants.js';
import { CANDIDATE_FIELD_ORDER, ConventionExtraction, ProposedCandidateSchema, SalvagedExtraction } from './llm-schema.js';

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

  it('serializes to a flat JSON Schema: no $ref, nulls as anyOf (not OpenAPI `nullable`)', () => {
    const json = JSON.stringify(toJsonSchema(ConventionExtraction, 'ConventionExtraction').schema);
    expect(json).not.toContain('$ref');
    expect(json).not.toContain('"nullable"');
    expect(json).toContain('"signal_id":{"anyOf":[{"type":"string","pattern":"^S\\\\d+$"},{"type":"null"}]}');
    expect(ConventionExtraction.safeParse({ candidates: [{ ...cand, signal_id: 'S2' }] }).success).toBe(true);
    expect(ConventionExtraction.safeParse({ candidates: [{ ...cand, signal_id: 'signal-2' }] }).success).toBe(false);
  });

  describe('SalvagedExtraction (the PROPOSE parse)', () => {
    it('keeps valid candidates, drops invalid ones and counts them', () => {
      const out = SalvagedExtraction.parse({
        observed_patterns: ['named exports in src/'],
        candidates: [cand, { ...cand, category: 'style' }, { ...cand, rule: 'short' }, 'junk'],
      });
      expect(out.candidates).toEqual([cand]);
      expect(out.rejected).toBe(3);
    });

    it('drops an over-long quote, cuts evidence to 3 and nulls a bad counter_example', () => {
      const long = { ...quote, quote: 'x'.repeat(241) };
      const out = SalvagedExtraction.parse({
        candidates: [{ ...cand, evidence: [long, quote, quote, quote, quote], counter_example: long }],
      });
      expect(out.candidates[0]!.evidence).toEqual([quote, quote, quote]);
      expect(out.candidates[0]!.counter_example).toBeNull();
      expect(out.rejected).toBe(0);
      // Every survivor still satisfies the strict contract.
      expect(ConventionExtraction.safeParse({ candidates: out.candidates }).success).toBe(true);
    });

    it('drops a candidate left with no valid quote', () => {
      const out = SalvagedExtraction.parse({ candidates: [{ ...cand, evidence: [{ ...quote, path: 1 }] }] });
      expect(out).toEqual({ candidates: [], rejected: 1 });
    });

    it('caps at MAX_CANDIDATES (8) and counts the rest as rejected', () => {
      const out = SalvagedExtraction.parse({ candidates: Array(MAX_CANDIDATES + 2).fill(cand) });
      expect(out.candidates).toHaveLength(MAX_CANDIDATES);
      expect(out.rejected).toBe(2);
    });

    it('still rejects a reply without a candidates array (goes to repair)', () => {
      expect(SalvagedExtraction.safeParse({ rule: 'x' }).success).toBe(false);
      expect(SalvagedExtraction.safeParse({ candidates: {} }).success).toBe(false);
    });
  });
});
