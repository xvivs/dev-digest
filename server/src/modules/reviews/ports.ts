/**
 * PORTS — what the smart-diff use case needs from the outside, declared by the
 * inner ring. `ReviewRepository` implements `SmartDiffSource` (rows are mapped
 * to domain inputs there); `wiring.ts` hands it over; the unit test fakes it.
 */
import type { SmartDiffFileInput, SmartDiffReviewInput } from './domain.js';

export interface SmartDiffSource {
  /** Workspace-scoped existence check: a foreign or missing PR is `false`. */
  pullExists(workspaceId: string, prId: string): Promise<boolean>;
  getSmartDiffFiles(prId: string): Promise<SmartDiffFileInput[]>;
  /** Persisted reviews (newest first) with their findings; no LLM/GitHub. */
  getSmartDiffReviews(prId: string): Promise<SmartDiffReviewInput[]>;
}
