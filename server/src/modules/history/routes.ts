import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrHistoryResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildHistoryService } from './wiring.js';
import type { PrHistoryView } from './types.js';

function toResponse(v: PrHistoryView): PrHistoryResponse {
  return {
    status: v.status,
    reason: v.reason,
    history: v.history,
    queried_paths: v.queriedPaths,
    cached: v.cached,
    computed_at: v.computedAt ? v.computedAt.toISOString() : null,
  };
}

/**
 * history module (ADR 0023): prior merged PRs that touched the same files.
 *   GET /pulls/:id/history -> PrHistoryResponse
 * A foreign PR gets 404 (the service returns `undefined` for it).
 */
export default async function historyRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = buildHistoryService(container);

  app.get('/pulls/:id/history', { schema: { params: IdParams, response: { 200: PrHistoryResponse } } }, async (req): Promise<PrHistoryResponse> => {
    const { workspaceId } = await getContext(container, req);
    const view = await service.getForPull(workspaceId, req.params.id);
    if (!view) throw new NotFoundError('Pull request not found');
    return toResponse(view);
  });
}
