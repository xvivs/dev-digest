/**
 * repo-intel HTTP module.
 *
 *   GET  /repos/:id/index-state  → IndexState (always works; degraded on missing data)
 *   POST /repos/:id/resync       → requests a resync through the per-repo index
 *                                  gate (202): fetch latest from origin +
 *                                  incremental reindex. A busy repo coalesces
 *                                  into one trailing pass, enqueued as its own
 *                                  job once the repo is idle.
 *
 * Job-handler registration lives here: this plugin runs once at app boot and
 * calls `RepoIntelService.registerIndexJobHandlers()` so INDEX/REFRESH/RESYNC
 * jobs have a handler to run against. Every index job is requested through
 * `repoIntel.requestIndex(...)` (spec 06 D4, ADR 0025) — never by enqueueing
 * INDEX/REFRESH/RESYNC on `container.jobs` directly, which would bypass the gate.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import type { IndexState } from './types.js';

/** 202 body of POST /repos/:id/resync: coalesced into the trailing pass, degraded (no handler), or queued.
 *  Order matters: zod serializes with the first matching member and strips the rest, so the
 *  members with extra required keys come before the one that only needs `status`. */
const ResyncAccepted = z.union([
  z.object({ status: z.literal('accepted'), coalesced: z.literal(true) }),
  z.object({ status: z.literal('accepted'), degraded: z.literal(true), reason: z.literal('no_handler') }),
  z.object({ status: z.literal('accepted'), jobId: z.string().optional() }),
]);
type ResyncAccepted = z.infer<typeof ResyncAccepted>;

export default async function repoIntelRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  // Register the INDEX/REFRESH/RESYNC handlers exactly once at module load, on
  // the container's one RepoIntelService (the same instance `container.repoIntel`
  // returns without an override, so handlers and facade share one index gate).
  // `repoIntelService` ignores overrides, so handlers always run the real pipelines.
  const service = container.repoIntelService;
  service.registerIndexJobHandlers();

  app.get(
    '/repos/:id/index-state',
    { schema: { params: IdParams } },
    async (req): Promise<IndexState> => {
      // Resolve tenancy so the request is workspace-scoped even though the
      // facade itself is tenant-agnostic (consistent with blast routes).
      await getContext(container, req);
      return container.repoIntel.getIndexState(req.params.id);
    },
  );

  app.post(
    '/repos/:id/resync',
    { schema: { params: IdParams, response: { 202: ResyncAccepted } } },
    async (req, reply): Promise<ResyncAccepted> => {
      const { workspaceId } = await getContext(container, req);
      // Tenancy: the gate is tenant-agnostic, so scope the repo first (AC-20).
      const clone = await container.repoClone.getCloneStatus(workspaceId, req.params.id);
      if (!clone) throw new NotFoundError('Repo not found');
      // 202 even when enqueue fails (no handler / DB hiccup) so the UI can
      // still poll /index-state without an inline error path. The actual
      // outcome shows up in `repo_index_state` once the worker runs.
      const result = await service.requestIndex(workspaceId, req.params.id, 'resync');
      reply.code(202);
      if (result.queued) return { status: 'accepted', jobId: result.jobId };
      if (result.reason === 'in_flight') return { status: 'accepted', coalesced: true };
      return { status: 'accepted', degraded: true, reason: 'no_handler' };
    },
  );
}
