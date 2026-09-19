import { z } from 'zod';

/**
 * Where a cost figure came from. Never store a cost without one.
 * - `provider`  — the provider's own charge, returned in the API response
 * - `estimated` — computed locally from the price table; an estimate, not a charge
 */
export const CostSource = z.enum(['provider', 'estimated']);
export type CostSource = z.infer<typeof CostSource>;

/** Why a run has no cost. Derived from run status at read time; never persisted. */
export const CostMissingReason = z.enum(['pending', 'failed', 'no_price']);
export type CostMissingReason = z.infer<typeof CostMissingReason>;
