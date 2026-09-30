/**
 * COMPOSITION — the history module's composition root. Adapts the container's
 * shared seams (review repo, GitHub client) to the service's ports. The module
 * never imports another module.
 */
import type { Container } from '../../platform/container.js';
import { HistoryRepository } from './repository.js';
import { HistoryService } from './service.js';

export function buildHistoryService(container: Container): HistoryService {
  return new HistoryService({
    store: new HistoryRepository(container.db),
    pulls: {
      getPull: async (workspaceId, prId) => {
        const p = await container.reviewRepo.getPull(workspaceId, prId);
        return p
          ? { id: p.id, repoId: p.repoId, number: p.number, headSha: p.headSha, base: p.base }
          : undefined;
      },
      getRepo: async (repoId) => {
        const r = await container.reviewRepo.getRepo(repoId);
        return r ? { owner: r.owner, name: r.name } : undefined;
      },
      getPrFiles: async (prId) =>
        (await container.reviewRepo.getPrFiles(prId)).map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
        })),
    },
    // A missing token surfaces as ConfigError from container.github().
    github: {
      list: async (repo, ref, paths, perPath) =>
        (await container.github()).listPathHistory(repo, ref, paths, perPath),
    },
    // Late-bound: app.ts assigns container.logger after the container is built.
    log: {
      debug: (o, m) => container.logger.debug(o, m),
      warn: (o, m) => container.logger.warn(o, m),
    },
  });
}
