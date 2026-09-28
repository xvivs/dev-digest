/**
 * PORTS — what the service needs from the outside world, declared by the
 * inner ring. `repository.ts` implements `ExampleStore` with Drizzle; tests
 * implement it in memory. Add a port only for a service that has logic worth
 * testing without Postgres (see references/anti-patterns.md).
 */
import type { Example, NewExample } from './domain.js';

export interface ExampleStore {
  list(workspaceId: string): Promise<Example[]>;
  findByName(workspaceId: string, name: string): Promise<Example | undefined>;
  insert(input: NewExample): Promise<Example>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  /**
   * Run `work` atomically. The store handed to `work` is bound to the
   * transaction — use it, not `this`, inside the callback.
   */
  transaction<T>(work: (store: ExampleStore) => Promise<T>): Promise<T>;
}
