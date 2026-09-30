/**
 * Review module constants.
 */
import type { ProviderRouting } from '@devdigest/shared';

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * OpenRouter upstream routing for review calls. Without a `provider` block
 * OpenRouter load-balances by price, and upstreams of one model differ from
 * 10 s to 100 s+ on the same prompt (reviewer-core INSIGHTS, conventions
 * measurements). `sort: 'throughput'` is model-agnostic, so it is safe for any
 * agent model; no `ignore` list, since per-upstream slugs are per model and
 * were measured for the conventions prompt only. Fallbacks stay on so one
 * upstream outage does not fail the run.
 */
export const REVIEW_PROVIDER_ROUTING: ProviderRouting = {
  sort: 'throughput',
  allowFallbacks: true,
};

/*
 * Reasoning stays ON for review calls — deliberately no `disableReasoning`.
 * Measured 2026-09-30 on API Contract Reviewer (deepseek/deepseek-v4-flash,
 * PR #5, throughput routing): reasoning off → 0 findings in 3/3 runs (4-7 s,
 * 200-420 output tokens; the summary even calls the breaking renames
 * "consistent"); reasoning on → 4 findings in 43 s, matching the experiment's
 * baseline. The `content: null` failure that made conventions turn it off
 * comes from a `max_tokens` cap, which review calls do not set; stalls are
 * bounded by the per-call deadline instead. It is also unsafe as a blanket
 * default: models with mandatory reasoning (OpenRouter `/models` →
 * `reasoning.mandatory: true`, e.g. openai/gpt-5-mini) reject a disable
 * request. `ReviewInput.disableReasoning` remains for a caller that caps output.
 */
