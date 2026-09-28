/**
 * COMPOSITION — the module's composition root. The only module file allowed
 * to import both the service and the concrete repository. `routes.ts` calls
 * this; tests skip it and pass a fake store to the service directly.
 */
import type { Container } from '../../platform/container.js';
import { SkillsService } from './service.js';

export function buildSkillsService(container: Container): SkillsService {
  return new SkillsService(container.skillsRepo);
}
