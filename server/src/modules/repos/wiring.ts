/**
 * COMPOSITION — the repos module's composition root: pairs `RepoService` with
 * its concrete repository. `container.repoService` is the ONLY caller: one
 * instance per container, so the routes (handler registration + HTTP) and
 * `container.repoClone` share its clone gate and clone failures.
 */
import type { Container } from '../../platform/container.js';
import { RepoRepository } from './repository.js';
import { RepoService } from './service.js';

export function buildRepoService(container: Container): RepoService {
  return new RepoService(container, new RepoRepository(container.db));
}
