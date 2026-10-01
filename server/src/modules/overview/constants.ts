/**
 * Overview module literals (spec 06 D9).
 */

/** One prepare can cost two LLM requests: the same shape as `POST /pulls/:id/brief/derive`. */
export const PREPARE_RATE_LIMIT = { max: 5, timeWindow: '1 minute' } as const;

/**
 * Own bucket for readiness polling (2 s while in flight, several tabs), so it
 * never eats the global 120/min budget.
 */
export const READINESS_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const;
