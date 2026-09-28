/**
 * INFRASTRUCTURE — Drizzle implementation of `ExampleStore`. The only file in
 * the module that imports `drizzle-orm` or `db/**`. Rows never leave this
 * file: `toExample` maps them to the domain shape.
 *
 * TEMPLATE: replace `t.examples` with the module's table (declared in
 * `src/db/schema/<domain>.ts`, then `pnpm db:generate`).
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Example, NewExample } from './domain.js';
import type { ExampleStore } from './ports.js';

/** A Drizzle transaction handle — structurally a `Db` for queries. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ExampleRow = typeof t.examples.$inferSelect;

function toExample(row: ExampleRow): Example {
  return { id: row.id, workspaceId: row.workspaceId, name: row.name, createdAt: row.createdAt };
}

export class ExampleRepository implements ExampleStore {
  constructor(private readonly db: Db | Tx) {}

  async list(workspaceId: string): Promise<Example[]> {
    const rows = await this.db
      .select()
      .from(t.examples)
      .where(eq(t.examples.workspaceId, workspaceId));
    return rows.map(toExample);
  }

  async findByName(workspaceId: string, name: string): Promise<Example | undefined> {
    const [row] = await this.db
      .select()
      .from(t.examples)
      .where(and(eq(t.examples.workspaceId, workspaceId), eq(t.examples.name, name)))
      .limit(1);
    return row ? toExample(row) : undefined;
  }

  async insert(input: NewExample): Promise<Example> {
    const [row] = await this.db.insert(t.examples).values(input).returning();
    if (!row) throw new Error('insert into examples returned no row');
    return toExample(row);
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.examples)
      .where(and(eq(t.examples.id, id), eq(t.examples.workspaceId, workspaceId)))
      .returning({ id: t.examples.id });
    return rows.length > 0;
  }

  /**
   * Nested calls reuse the outer transaction (Drizzle opens a savepoint), so a
   * service can compose stores freely. Never hand a memoized container getter
   * (`container.reviewRepo`) into this callback — it is bound to the root `db`.
   */
  transaction<T>(work: (store: ExampleStore) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new ExampleRepository(tx)));
  }
}
