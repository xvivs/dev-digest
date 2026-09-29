/**
 * COMPOSITION — the module's composition root. The only module file that sees
 * the service, the concrete repository and the container together. Adapts the
 * container (git, repo-intel, review history, feature model, LLM, jobs) to the
 * narrow ports the service declares, and registers the job handler.
 */
import { stat } from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import { resolveSafeRepoPath } from '../_shared/safe-path.js';
import { CONVENTIONS_JOB_KIND } from './constants.js';
import { ConventionsRepository } from './repository.js';
import { ConventionsService } from './service.js';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Build the service over the container. Does not register the job handler. */
export function buildConventionsService(container: Container): ConventionsService {
  const store = new ConventionsRepository(container.db, {
    skillsOn: (tx) => container.skillsRepoOn(tx),
    agentsOn: (tx) => container.agentsRepoOn(tx),
  });
  return new ConventionsService({
    store,
    repoIndex: {
      indexStatus: async (repoId) => (await container.repoIntel.getIndexState(repoId)).status,
      topFilesByRank: (repoId, n) => container.repoIntel.getTopFilesByRank(repoId, n),
    },
    reviews: {
      recurringFindings: (repoId, minPrs, limit) => container.reviewRepo.recurringFindings(repoId, minPrs, limit),
    },
    files: {
      cloneRoot: (ref) => container.git.clonePathFor(ref),
      cloneExists: (ref) => isDirectory(container.git.clonePathFor(ref)),
      assertSafe: async (root, rel) => {
        await resolveSafeRepoPath(root, rel);
      },
      // Same RELATIVE path the guard checked; the adapter joins it to the clone root.
      readFile: (ref, rel) => container.git.readFile(ref, rel),
      currentHead: (ref) => container.git.currentHead(ref),
    },
    models: {
      resolve: (workspaceId) => container.featureModel(workspaceId, 'conventions'),
      llm: (provider) => container.llm(provider),
    },
    jobs: {
      enqueue: (workspaceId, payload) => container.jobs.enqueue(workspaceId, CONVENTIONS_JOB_KIND, payload),
    },
  });
}

/** Build the service and register its job handler (a thin driving adapter). */
export function wireConventions(container: Container): ConventionsService {
  const service = buildConventionsService(container);
  container.jobs.register(CONVENTIONS_JOB_KIND, (payload) => service.runScanJob(payload));
  return service;
}
