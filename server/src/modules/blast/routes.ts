import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBlastResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildBlastService } from './wiring.js';
import type { PrBlastView } from './types.js';

function toResponse(v: PrBlastView): PrBlastResponse {
  return {
    status: v.status,
    reason: v.reason,
    blast: v.blast,
    head_sha: v.headSha,
    source_sha: v.sourceSha,
    index_status: v.indexStatus,
    cached: v.cached,
    truncated: v.truncated,
    computed_at: v.computedAt ? v.computedAt.toISOString() : null,
  };
}

/**
 * blast module: downstream impact of a PR's changed symbols.
 *   GET /pulls/:id/blast -> PrBlastResponse
 * A foreign PR gets 404 (the service returns `undefined` for it).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = buildBlastService(container);

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req): Promise<PrBlastResponse> => {
    const { workspaceId } = await getContext(container, req);
    const view = await service.getForPull(workspaceId, req.params.id);
    if (!view) throw new NotFoundError('Pull request not found');
    return toResponse(view);
  });
}
