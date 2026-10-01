/**
 * APPLICATION — Smart Diff for a PR: files grouped by role with finding lines.
 * Reads persisted data only (no LLM, no GitHub). No SQL, no Fastify.
 */
import type { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff } from './domain.js';
import type { SmartDiffSource } from './ports.js';

export class SmartDiffService {
  constructor(private source: SmartDiffSource) {}

  /** `undefined` = PR not found in the workspace (the route maps it to 404). */
  async getForPull(workspaceId: string, prId: string): Promise<SmartDiff | undefined> {
    if (!(await this.source.pullExists(workspaceId, prId))) return undefined;
    const [files, reviews] = await Promise.all([
      this.source.getSmartDiffFiles(prId),
      this.source.getSmartDiffReviews(prId),
    ]);
    return buildSmartDiff(files, reviews);
  }
}
