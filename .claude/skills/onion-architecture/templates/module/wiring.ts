/**
 * COMPOSITION — the module's composition root. The only module file allowed
 * to import both the service and the concrete repository. `routes.ts` and job
 * handlers call this; tests skip it and pass a fake store to the service.
 */
import type { Container } from '../../platform/container.js';
import { ExampleRepository } from './repository.js';
import { ExampleService } from './service.js';

export function buildExampleService(container: Container): ExampleService {
  return new ExampleService(new ExampleRepository(container.db));
}
