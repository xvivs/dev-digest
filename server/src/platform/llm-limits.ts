/**
 * Limits every LLM adapter applies to one model call. Single source of truth:
 * the adapters import them, and the eval job timeout (modules/evals/domain.ts)
 * derives its worst case from them, so the two cannot drift apart.
 */

/** Per-attempt timeout when the request carries no `timeoutMs`. */
export const LLM_CALL_TIMEOUT_MS = 60_000;

/**
 * Structured-output reprompts after a schema-invalid answer (attempts = this + 1).
 * Mirrors reviewer-core `DEFAULT_REVIEW_MAX_RETRIES`, which the review engine
 * passes as `req.maxRetries`.
 */
export const LLM_STRUCTURED_MAX_RETRIES = 2;
