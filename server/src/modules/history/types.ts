/**
 * History module view type. The service returns this camelCase view; `routes.ts`
 * maps it to the snake_case `PrHistoryResponse` DTO (same split as `brief`).
 */
import type { HistoryReason, HistoryStatus, PrHistoryItem } from '@devdigest/shared';

export interface PrHistoryView {
  status: HistoryStatus;
  reason: HistoryReason | null;
  history: PrHistoryItem[];
  queriedPaths: string[];
  cached: boolean;
  computedAt: Date | null;
}
