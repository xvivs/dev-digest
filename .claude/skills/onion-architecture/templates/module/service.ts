/**
 * APPLICATION — use cases of the `example` module. Depends on `domain.ts` and
 * `ports.ts` only: no Drizzle, no `db/**`, no Fastify, no concrete repository.
 * Owns transaction boundaries (via the port) and returns domain objects; the
 * route maps them to the HTTP DTO.
 */
import {
  ExampleNameTakenError,
  normalizeExampleName,
  type Example,
} from './domain.js';
import type { ExampleStore } from './ports.js';

export class ExampleService {
  constructor(private readonly store: ExampleStore) {}

  list(workspaceId: string): Promise<Example[]> {
    return this.store.list(workspaceId);
  }

  /** Check-then-insert must be atomic, so it runs inside one transaction. */
  async create(workspaceId: string, rawName: string): Promise<Example> {
    const name = normalizeExampleName(rawName);
    return this.store.transaction(async (tx) => {
      if (await tx.findByName(workspaceId, name)) throw new ExampleNameTakenError(name);
      return tx.insert({ workspaceId, name });
    });
  }

  delete(workspaceId: string, id: string): Promise<boolean> {
    return this.store.deleteById(workspaceId, id);
  }
}
