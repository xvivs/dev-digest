/**
 * COMPOSITION — the overview module's composition root. Adapts the container's
 * shared seams to the service's ports:
 *
 *   PullLookup <- container.reviewRepo.getPull (tenancy + repoId)
 *   ClonePort  <- container.repoClone
 *   IndexPort  <- container.repoIntel (getIndexReadiness, requestIndex)
 *   BriefPort  <- container.prBrief (on-demand derive, only when idle)
 *
 * The module owns no table and never imports another module.
 */
import type { Container } from '../../platform/container.js';
import { OverviewService } from './service.js';

export function buildOverviewService(container: Container): OverviewService {
  return new OverviewService({
    pulls: {
      getPull: async (workspaceId, prId) => {
        const p = await container.reviewRepo.getPull(workspaceId, prId);
        return p ? { id: p.id, repoId: p.repoId } : undefined;
      },
    },
    clone: {
      getCloneStatus: (workspaceId, repoId) => container.repoClone.getCloneStatus(workspaceId, repoId),
      requestClone: (workspaceId, repoId) => container.repoClone.requestClone(workspaceId, repoId),
    },
    index: {
      getReadiness: async (repoId) => {
        const r = await container.repoIntel.getIndexReadiness(repoId);
        return {
          enabled: r.enabled,
          cloneHead: r.cloneHead,
          state: r.state
            ? {
                status: r.state.status,
                lastIndexedSha: r.state.lastIndexedSha,
                lastIndexedAt: r.state.lastIndexedAt,
                partialReason: r.state.partialReason ?? null,
              }
            : null,
          versionCurrent: r.versionCurrent,
          inFlight: r.inFlight,
        };
      },
      requestIndex: (workspaceId, repoId, kind) => container.repoIntel.requestIndex(workspaceId, repoId, kind),
    },
    brief: {
      getPhases: async (workspaceId, prId) => {
        const [intent, risks] = await Promise.all([
          container.prBrief.getIntent(workspaceId, prId),
          container.prBrief.getRisks(workspaceId, prId),
        ]);
        if (!intent || !risks) return undefined;
        return { intent, risks };
      },
      requestDerive: (workspaceId, prId) =>
        container.prBrief.requestDerive(workspaceId, prId, 'on_demand', { onlyIfIdle: true }),
    },
    // Late-bound: app.ts assigns container.logger after the container is built.
    log: { warn: (o, m) => container.logger.warn(o, m) },
  });
}
