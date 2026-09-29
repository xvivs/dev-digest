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

export const ProposedQuoteSchema = z.object({
  path: z.string().max(300),
  quote: z.string().max(QUOTE_MAX),
  line_hint: z.number().int().nullable(),
});

export const ProposedCandidateSchema = z.object({
  rule: z.string().min(RULE_MIN).max(RULE_MAX),
  evidence: z.array(ProposedQuoteSchema).min(1).max(MAX_QUOTES),
  counter_example: ProposedQuoteSchema.nullable(),
  origin: ConventionOrigin,
  signal_id: z.string().nullable(),
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
