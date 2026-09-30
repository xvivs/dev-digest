/**
 * COMPOSITION — the module's composition root. The only module file allowed
 * to import both the service and the concrete repository. `routes.ts` calls
 * this; tests skip it and pass a fake store to the service directly.
 */
import type { Container } from '../../platform/container.js';
import { SkillStatsService, SkillsService } from './service.js';

export function buildSkillsService(container: Container): SkillsService {
  return new SkillsService(container.skillsRepo);
}

/** Cost footprint priced with the live price book (static table fallback);
 *  the impact suite comes from the evals read model on the container. */
export function buildSkillStatsService(container: Container): SkillStatsService {
  return new SkillStatsService(
    container.skillsRepo,
    (model, tokensIn, tokensOut) => container.priceBook.estimate(model, tokensIn, tokensOut),
    { findImpactSuite: (workspaceId, skillId) => container.evalsRepo.findImpactSuite(workspaceId, skillId) },
  );
}
