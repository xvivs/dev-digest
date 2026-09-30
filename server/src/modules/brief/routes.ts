import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DeriveBriefResponse,
  PrIntentResponse,
  PrRisksResponse,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { registerBriefJobs } from './wiring.js';

/**
 * brief module (ADR 0022): derived PR intent and risk areas.
 *   GET  /pulls/:id/intent        -> PrIntentResponse
 *   GET  /pulls/:id/risks         -> PrRisksResponse
 *   POST /pulls/:id/brief/derive  -> 202 { queued }   (on-demand, bypasses the automatic gate)
 *
 * Routes resolve `app.container.prBrief` (one memoized facade); a foreign PR gets
 * 404 because the service returns `undefined` for it.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // The job handler is a driving adapter, registered once at plugin boot.
  registerBriefJobs(container);

  app.get('/pulls/:id/intent', { schema: { params: IdParams, response: { 200: PrIntentResponse } } }, async (req): Promise<PrIntentResponse> => {
    const { workspaceId } = await getContext(container, req);
    const view = await container.prBrief.getIntent(workspaceId, req.params.id);
    if (!view) throw new NotFoundError('Pull request not found');
    return {
      intent: view.record,
      stale: view.stale,
      in_flight: view.inFlight,
      last_failure: view.lastFailure,
    };
  });

  app.get('/pulls/:id/risks', { schema: { params: IdParams, response: { 200: PrRisksResponse } } }, async (req): Promise<PrRisksResponse> => {
    const { workspaceId } = await getContext(container, req);
    const view = await container.prBrief.getRisks(workspaceId, req.params.id);
    if (!view) throw new NotFoundError('Pull request not found');
    return {
      risks: view.record,
      stale: view.stale,
      in_flight: view.inFlight,
      last_failure: view.lastFailure,
    };
  });

  // Each call can cost two LLM requests: same tight limit shape as POST /review.
  app.post(
    '/pulls/:id/brief/derive',
    { schema: { params: IdParams, response: { 202: DeriveBriefResponse } }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply): Promise<DeriveBriefResponse> => {
      const { workspaceId } = await getContext(container, req);
      const res = await container.prBrief.requestDerive(workspaceId, req.params.id, 'on_demand');
      if (!res) throw new NotFoundError('Pull request not found');
      reply.code(202);
      return { queued: res.queued };
    },
  );
}
