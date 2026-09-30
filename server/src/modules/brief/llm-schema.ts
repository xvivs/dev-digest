/**
 * Structured-output schemas for the two brief LLM calls (server-only).
 *
 * No `.nullable()` anywhere: `z.string().nullable()` serializes to an
 * OpenAPI-style `nullable` that strict grammars ignore, and the model then
 * invents values (server INSIGHTS, conventions/llm-schema.ts). Bounds are NOT
 * enforced here either: the calls run in JSON mode, so a too-long string would
 * fail the whole response and trigger a costly repair. The output is clamped
 * in `intent-prompt.ts` / `risk-prompt.ts` instead.
 *
 * A fresh zod object per use keeps the emitted JSON schema flat (no `$ref`).
 */
import { z } from 'zod';
import { IntentConfidence, RiskKind, RiskSeverity } from '@devdigest/shared';

export const IntentLlmSchema = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: IntentConfidence,
});
export type IntentLlmOutput = z.infer<typeof IntentLlmSchema>;

const riskSchema = () =>
  z.object({
    kind: RiskKind,
    title: z.string(),
    explanation: z.string(),
    severity: RiskSeverity,
    file_refs: z.array(z.string()),
  });

export const RisksLlmSchema = z.object({
  risks: z.array(riskSchema()),
});
export type RisksLlmOutput = z.infer<typeof RisksLlmSchema>;
