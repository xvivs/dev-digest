/**
 * Hermetic unit test for the application ring. Lives at
 * `server/test/<name>-service.test.ts` (NOT `*.it.test.ts` — no Docker).
 * The Drizzle implementation gets its own `<name>-repository.it.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { ExampleService } from '../src/modules/example/service.js';
import {
  ExampleNameTakenError,
  InvalidExampleNameError,
  type Example,
  type NewExample,
} from '../src/modules/example/domain.js';
import type { ExampleStore } from '../src/modules/example/ports.js';

/** In-memory fake of the port. `transaction` just runs the work on itself. */
class InMemoryExampleStore implements ExampleStore {
  rows: Example[] = [];
  async list(workspaceId: string) {
    return this.rows.filter((r) => r.workspaceId === workspaceId);
  }
  async findByName(workspaceId: string, name: string) {
    return this.rows.find((r) => r.workspaceId === workspaceId && r.name === name);
  }
  async insert(input: NewExample) {
    const row: Example = { ...input, id: `id-${this.rows.length + 1}`, createdAt: new Date(0) };
    this.rows.push(row);
    return row;
  }
  async deleteById(workspaceId: string, id: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.workspaceId === workspaceId && r.id === id));
    return this.rows.length < before;
  }
  transaction<T>(work: (store: ExampleStore) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('ExampleService', () => {
  it('normalizes the name before storing it', async () => {
    const store = new InMemoryExampleStore();
    const created = await new ExampleService(store).create('ws', '  My   example ');
    expect(created.name).toBe('My example');
  });

  it('rejects a duplicate name in the same workspace', async () => {
    const service = new ExampleService(new InMemoryExampleStore());
    await service.create('ws', 'dup');
    await expect(service.create('ws', 'dup')).rejects.toBeInstanceOf(ExampleNameTakenError);
  });

  it('allows the same name in another workspace', async () => {
    const service = new ExampleService(new InMemoryExampleStore());
    await service.create('ws-a', 'shared');
    await expect(service.create('ws-b', 'shared')).resolves.toMatchObject({ name: 'shared' });
  });

  it('rejects a blank name', async () => {
    const service = new ExampleService(new InMemoryExampleStore());
    await expect(service.create('ws', '   ')).rejects.toBeInstanceOf(InvalidExampleNameError);
  });
});
