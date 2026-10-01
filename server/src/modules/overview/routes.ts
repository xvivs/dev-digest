import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrepareOverviewRequest, PrepareOverviewResponse, PrOverviewReadiness } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { PREPARE_RATE_LIMIT, READINESS_RATE_LIMIT } from './constants.js';
import { buildOverviewService } from './wiring.js';

/**
 * overview module (spec 06): one-click "Prepare overview".
 *   GET  /pulls/:id/overview/readiness -> PrOverviewReadiness (cheap: no LLM, GitHub or blast)
 *   POST /pulls/:id/overview/prepare   -> 202 PrepareOverviewResponse
 *                                         body { reindex_partial?: boolean } (strict; optional)
 * A foreign PR gets 404 (the service returns `undefined` for it).
 */
export default async function overviewRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = buildOverviewService(container);

  app.get(
    '/pulls/:id/overview/readiness',
    {
      schema: { params: IdParams, response: { 200: PrOverviewReadiness } },
      config: { rateLimit: { ...READINESS_RATE_LIMIT } },
    },
    async (req): Promise<PrOverviewReadiness> => {
      const { workspaceId } = await getContext(container, req);
      const readiness = await service.readiness(workspaceId, req.params.id);
      if (!readiness) throw new NotFoundError('Pull request not found');
      return readiness;
    },
  );

  app.post(
    '/pulls/:id/overview/prepare',
    {
      // Optional: Fastify hands a body-less POST to the validator as `null`
      // (not `undefined`), so `.nullish()`; it means `{}`.
      schema: { params: IdParams, body: PrepareOverviewRequest.nullish(), response: { 202: PrepareOverviewResponse } },
      config: { rateLimit: { ...PREPARE_RATE_LIMIT } },
    },
    async (req, reply): Promise<PrepareOverviewResponse> => {
      const { workspaceId } = await getContext(container, req);
      const res = await service.prepare(workspaceId, req.params.id, req.body ?? {});
      if (!res) throw new NotFoundError('Pull request not found');
      reply.code(202);
      return res;
    },
  );
}
