/**
 * DOMAIN constants. Bump `BLAST_MAPPING_VERSION` whenever the status/reason
 * mapping or the ordering in `domain.ts` changes: cached rows written under an
 * older version are stale and get recomputed (spec 08, D5).
 */
export const BLAST_MAPPING_VERSION = 2;
