import type { EvalSuiteMode } from "@devdigest/shared";

/** Width (px) of the Run on evals modal. */
export const RUN_MODAL_WIDTH = 560;

/** Mode radio order; Full first because only it yields a verdict (ADR 0017). */
export const RUN_MODES: readonly EvalSuiteMode[] = ["full", "quick"];

/** Server error codes with their own copy under `skillEvals.runModal.errors` (spec "Suites"). */
export const RUN_ERROR_CODES = [
  "eval_skill_not_vetted",
  "eval_no_cases",
  "eval_case_not_found",
  "eval_price_unknown",
  "eval_too_many_jobs",
  "eval_budget_exceeded",
  "eval_suite_busy",
  "eval_suite_stale",
  "eval_carrier_not_linked",
] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

/** The trust gate (ADR 0012): the only error that offers a way to fix it. */
export const TRUST_GATE_CODE: RunErrorCode = "eval_skill_not_vetted";
