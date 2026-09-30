/**
 * Blast module view type. The service returns this camelCase view; `routes.ts`
 * maps it to the snake_case `PrBlastResponse` DTO (same split as `brief`).
 */
import type { BlastRadius, BlastReason, BlastStatus } from '@devdigest/shared';

export interface PrBlastView {
  status: BlastStatus;
  reason: BlastReason | null;
  blast: BlastRadius | null;
  headSha: string;
  sourceSha: string | null;
  indexStatus: string;
  cached: boolean;
  truncated: boolean;
  computedAt: Date | null;
}
