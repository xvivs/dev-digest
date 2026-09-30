/**
 * COMPOSITION — the blast module's composition root. Adapts the container's
 * shared seams (review repo, repo-intel facade, git, config) to the service's
 * ports. The module never imports another module.
 */
import type { Container } from '../../platform/container.js';
import { BlastRepository } from './repository.js';
import { BlastService } from './service.js';

export function buildBlastService(container: Container): BlastService {
  return new BlastService({
    store: new BlastRepository(container.db),
    pulls: {
      getPull: async (workspaceId, prId) => {
        const p = await container.reviewRepo.getPull(workspaceId, prId);
        return p ? { id: p.id, repoId: p.repoId, headSha: p.headSha } : undefined;
      },
      getPrFiles: async (prId) =>
        (await container.reviewRepo.getPrFiles(prId)).map((f) => ({ path: f.path })),
    },
    keys: {
      getKey: async (repoId) => {
        const indexState = await container.repoIntel.getIndexState(repoId);
        let cloneHead = '';
        const repo = await container.reviewRepo.getRepo(repoId);
        if (repo) {
          try {
            cloneHead = await container.git.currentHead({ owner: repo.owner, name: repo.name });
          } catch {
            cloneHead = '';
          }
        }
        return {
          enabled: container.config.repoIntelEnabled,
          indexState: {
            status: indexState.status,
            lastIndexedSha: indexState.lastIndexedSha,
            indexerVersion: indexState.indexerVersion,
          },
          cloneHead,
        };
      },
    },
    blast: {
      getBlastRadius: async (repoId, changedFiles) => {
        const r = await container.repoIntel.getBlastRadius(repoId, changedFiles);
        return {
          changedSymbols: r.changedSymbols,
          callers: r.callers,
          factsByFile: r.factsByFile,
          degraded: r.degraded,
          truncated: r.truncated,
        };
      },
    },
    // Late-bound: app.ts assigns container.logger after the container is built.
    log: { debug: (o, m) => container.logger.debug(o, m) },
  });
}
