/**
 * Structured-output schema for the PROPOSE step (AC-13). The object key order
 * IS the generation order the model follows: rule → evidence → counter_example
 * → origin → signal_id → prior_ref → category → llm_confidence. The model
 * classifies and scores only after it has written the rule and its evidence
 * (G2: with category and confidence first, one reference run gave all 12
 * candidates the same category and a 0.90 score). `llm-schema.test.ts` pins it.
 *
 * Everything the model returns is untrusted; VERIFY (`domain.ts`) decides what
 * survives.
 */
import { z } from 'zod';
import { ConventionCategory, ConventionOrigin } from '@devdigest/shared';
import { MAX_CANDIDATES, MAX_QUOTES, QUOTE_MAX, RULE_MAX, RULE_MIN } from './constants.js';
import type { ProposedCandidate } from './domain.js';

/**
 * A fresh zod object per use: the JSON-schema converter turns a REUSED zod
 * instance into a `$ref` into `definitions`, and several OpenRouter providers
 * handle `$ref` in strict mode badly. Inline copies keep the schema flat.
 */
const quoteSchema = () =>
  z.object({
    path: z.string().max(300),
    quote: z.string().max(QUOTE_MAX),
    line_hint: z.number().int().nullable(),
  });

export const ProposedQuoteSchema = quoteSchema();

export const ProposedCandidateSchema = z.object({
  rule: z.string().min(RULE_MIN).max(RULE_MAX),
  evidence: z.array(quoteSchema()).min(1).max(MAX_QUOTES),
  counter_example: quoteSchema().nullable(),
  origin: ConventionOrigin,
  // The pattern is load-bearing: a bare `z.string().nullable()` serializes as
  // `{type:"string", nullable:true}` (OpenAPI, not JSON Schema), which a strict
  // grammar reads as "string only" — the model then invents `S1..S10` ids.
  signal_id: z
    .string()
    .regex(/^S\d+$/)
    .nullable(),
  prior_ref: z
    .string()
    .regex(/^P\d+$/)
    .nullable(),
  category: ConventionCategory,
  llm_confidence: z.number().min(0).max(1),
});

export const ConventionExtraction = z.object({
  candidates: z.array(ProposedCandidateSchema).max(MAX_CANDIDATES),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/**
 * What the PROPOSE call actually parses with. The call runs in JSON mode (see
 * `service.ts`), so nothing enforces the bounds while the model writes: one
 * over-long quote or a fourth evidence item would fail the WHOLE response
 * against `ConventionExtraction`, and the repair call regenerates everything
 * (a measured 40-60 s, past the 100 s deadline). Salvage per item instead:
 * invalid quotes are dropped, extra ones cut to `MAX_QUOTES`, an invalid
 * counter_example becomes null, a candidate that is still invalid is dropped,
 * and candidates past `MAX_CANDIDATES` are cut. Every survivor satisfies
 * `ProposedCandidateSchema` exactly; `rejected` counts what was dropped so the
 * scan stats still add up. Only a reply that is not `{candidates: [...]}` at
 * all goes to repair.
 */
export const SalvagedExtraction = z
  .object({ candidates: z.array(z.unknown()) })
  .transform(({ candidates }) => {
    const kept: ProposedCandidate[] = [];
    let rejected = 0;
    for (const raw of candidates) {
      const parsed = ProposedCandidateSchema.safeParse(salvageCandidate(raw));
      if (parsed.success && kept.length < MAX_CANDIDATES) kept.push(parsed.data);
      else rejected += 1;
    }
    return { candidates: kept, rejected };
  });
export type SalvagedExtraction = z.infer<typeof SalvagedExtraction>;

function salvageCandidate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const c = raw as Record<string, unknown>;
  const evidence = Array.isArray(c.evidence)
    ? c.evidence.filter((q) => ProposedQuoteSchema.safeParse(q).success).slice(0, MAX_QUOTES)
    : c.evidence;
  const counter =
    c.counter_example === undefined || ProposedQuoteSchema.safeParse(c.counter_example).success
      ? c.counter_example
      : null;
  return { ...c, evidence, counter_example: counter };
}

/** The generation order the prompt and the schema promise (AC-13). */
export const CANDIDATE_FIELD_ORDER = [
  'rule',
  'evidence',
  'counter_example',
  'origin',
  'signal_id',
  'prior_ref',
  'category',
  'llm_confidence',
] as const;

// Compile-time guard: the schema output stays assignable to the domain shape.
type Assignable<A, B extends A> = B;
export type _CandidateShapeCheck = Assignable<ProposedCandidate, z.infer<typeof ProposedCandidateSchema>>;
