# Drizzle — the persistence ring

Rules for `repository.ts` / `repository/*.repo.ts`. General Drizzle syntax (schema definition, joins, migration CLI) lives in `.claude/skills/drizzle-orm-patterns/SKILL.md`, and type/index choices in `.claude/skills/postgresql-table-design/SKILL.md` — this file covers only what Onion layering adds on top of both.

## The repository is the only Drizzle file

Only `repository.ts` (or `repository/*.repo.ts` for a module split by aggregate, e.g. `reviews/repository/{pull,review,run}.repo.ts`) imports `drizzle-orm` or runtime `db/**`. `domain.ts`, `ports.ts`, `service.ts` and `routes.ts` cannot — enforced by `application-no-db`, `presentation-no-db`, `domain-is-pure` in `.dependency-cruiser.cjs` (full rule table: `enforcement.md`).

Schema is per-domain: `src/db/schema/<domain>.ts` (`agents.ts`, `reviews.ts`, `runs.ts`, …), barrel-exported from `src/db/schema.ts:15-27` so every consumer still writes `import * as t from '../../db/schema.js'`. Add a table to the matching domain file, then `pnpm db:generate` — never hand-edit `src/db/migrations/**` (`server/AGENTS.md` "Do not touch"); `pnpm db:migrate` does not run on boot.

The client type is `Db = PostgresJsDatabase<typeof schema>` (`server/src/db/client.ts:5`) — a repository constructor accepts `Db`, or `Db | Tx` once it supports transactions (below).

## Rows never leave infrastructure

`db/rows.ts` centralizes `$inferSelect` row types (`AgentRow`, `PullRow`, `FindingRow`, `AgentRunRow`, `AgentVersionRow` — `server/src/db/rows.ts:12-16`) so cross-cutting consumers can reference a row shape without importing another module's repository — but a row is still an infra type. The repository maps it to the domain shape before returning anything:

```ts
// Good — templates/module/repository.ts:19-21
function toExample(row: ExampleRow): Example {
  return { id: row.id, workspaceId: row.workspaceId, name: row.name, createdAt: row.createdAt };
}
```

A repository may re-export its own row type for existing callers (`AgentRow`/`AgentVersionRow` in `server/src/modules/agents/repository.ts:14-15`), but the row→domain mapping itself never leaves the file.

`helpers.ts` (the mapper role) may reference row types, `import type` only — `mapper-is-pure` allows `db/**` with `dependencyTypesNot: ['type-only']`:

```ts
// Bad — runtime import just to spell a type (modules/repos/helpers.ts:2, baseline)
import * as t from '../../db/schema.js';
type RepoRow = typeof t.repos.$inferSelect;
// Good
import type { RepoRow } from '../../db/rows.js';
```

## Transactions

Port: `transaction<T>(work: (store: XStore) => Promise<T>): Promise<T>` (`templates/module/ports.ts:9-19`). The Drizzle repository implements it by re-instantiating itself over the tx handle — `tx` is structurally a `Db` for every query method ([source](https://orm.drizzle.team/docs/transactions)):

```ts
// templates/module/repository.ts:16,24,62-64
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
constructor(private readonly db: Db | Tx) {}
transaction<T>(work: (store: ExampleStore) => Promise<T>): Promise<T> {
  return this.db.transaction((tx) => work(new ExampleRepository(tx)));
}
```

The service owns the boundary and stays DB-free — it calls the port, not Drizzle:

```ts
// templates/module/service.ts:22-28
async create(workspaceId: string, rawName: string): Promise<Example> {
  const name = normalizeExampleName(rawName);
  return this.store.transaction(async (tx) => {
    if (await tx.findByName(workspaceId, name)) throw new ExampleNameTakenError(name);
    return tx.insert({ workspaceId, name });
  });
}
```

The in-memory fake just runs the callback on itself — `transaction<T>(work) { return work(this); }` (`templates/module/service.test.ts:35-37`) — so a hermetic unit test exercises the same atomic-write code path with no Postgres.

**Bad — no atomicity.** `deleteAgentRun` (`server/src/modules/reviews/repository/run.repo.ts:92-105`) runs two independent deletes; its own comment admits `reviews` "must be removed explicitly here" alongside `agent_runs`, but nothing wraps them in `db.transaction` — a crash between the two calls leaves one deleted and the other not:

```ts
// run.repo.ts:97-103 — Bad
await db.delete(t.reviews).where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
const rows = await db.delete(t.agentRuns)
  .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
  .returning({ id: t.agentRuns.id });
```

Good — the same two deletes routed through the port's `transaction()`, as shown above.

**Memoized-container-getter trap.** `container.reviewRepo` is `(this._reviewRepo ??= new ReviewRepository(this.db))` (`server/src/platform/container.ts:99-101`) — bound to the root `db` forever; same for `container.agentsRepo` (`:95-97`). Never hand a memoized getter's repo into a transaction callback expecting a tx-scoped store; build `new XRepository(tx)` inside `db.transaction`, exactly as the port's own `transaction()` does.

**Nested transaction = savepoint.** A store composing another store inside `work` reuses the outer transaction — Drizzle opens a savepoint, so a service can compose ports freely without hand-managing nesting (`templates/module/repository.ts:57-61`; [source](https://orm.drizzle.team/docs/transactions)).

| Option | Mechanism | Cost | Verdict |
|---|---|---|---|
| A. explicit `tx?` param | every method takes `tx?: Db \| Tx`, `tx ?? this.db` | threads a param through every call site | not used — noisy at current repo sizes |
| **B. `new Repo(tx)`** | re-instantiate the repo class inside `db.transaction`; `tx` is structurally `Db` | repo must type `db: Db \| Tx`; container getters can't be reused tx-scoped | **the port's `transaction()` implementation** |
| C. AsyncLocalStorage | implicit tx context, no `tx` anywhere | not in Drizzle core, open discussion/issue; hides the boundary from the reviewer ([source](https://github.com/drizzle-team/drizzle-orm/discussions/2777); [source](https://github.com/drizzle-team/drizzle-orm/issues/543)) | rejected |
| **D. Unit-of-Work port** | `store.transaction(work)` on `ports.ts`, hides Drizzle from `service.ts` entirely ([source](https://martinfowler.com/eaaCatalog/unitOfWork.html)) | one indirection layer beyond calling Drizzle directly | **adopted now, implemented with B** ([source](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript)) |

## Reads for UI (CQRS-lite)

A read that only feeds a screen — never constructs or mutates a domain aggregate — may join straight to a DTO inside the repository, no domain object involved ([source](https://codeopinion.com/should-you-use-the-repository-pattern-with-cqrs-yes-and-no/)):

```ts
// Good — run.repo.ts:56-61, join → DTO, no domain entity
const rows = await db
  .select({ run: t.agentRuns, agentName: t.agents.name })
  .from(t.agentRuns)
  .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
  .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
  .orderBy(desc(t.agentRuns.ranAt));
```

`listRunsForPull` (`server/src/modules/reviews/repository/run.repo.ts:52-83`) maps this join straight to `RunSummary[]`. Allowed only inside `repository.ts` — `presentation-no-db` already blocks the same join from `routes.ts`. Naming it CQRS-lite matters because even inside the module this read skips the domain model on purpose; it is not a shortcut waiting to be "fixed" into one.

## Cross-module data

`container.agentsRepo` / `container.reviewRepo` exist so a module reaches shared data through the container, never through another module's `repository.ts` (`server/src/platform/container.ts:95-101`; `modules-no-cross-import` in `.dependency-cruiser.cjs`). One violation is frozen in the baseline — `modules/repos/service.ts:14` → `../repo-intel/constants.js` — grandfathered, not a pattern to repeat.

```ts
// Good — wiring.ts or service.ts
container.reviewRepo.listRunsForPull(workspaceId, prId);
// Bad — forbidden cross-module import
import { ReviewRepository } from '../reviews/repository.js';
```

## pgvector note

`CREATE EXTENSION IF NOT EXISTS vector` runs inside `runMigrations()` before migrations apply (`server/src/db/migrate.ts:23`), idempotent, reused by both `pnpm db:migrate` and the Testcontainers harness (`test/helpers/pg.ts:35-43`, image `pgvector/pgvector:pg16`) — a module never needs to create the extension itself.

Existing `vector(1536)` columns (`memory.embedding` — `schema/knowledge.ts:21`, `codeChunks.embedding` — `schema/context.ts:43`) carry only a plain B-tree index on `workspaceId`/`repoId`, no HNSW/IVFFlat index on the vector column itself — similarity search there is a full scan today. A similarity index needs an explicit operator class; pgvector has no default opclass for HNSW/IVFFlat ([source](https://orm.drizzle.team/docs/guides/vector-similarity-search)):

```ts
// Good
index('emb_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))
// Bad — CREATE INDEX fails, no default opclass for this access method
index('emb_idx').using('hnsw', t.embedding)
```

Generate the migration, don't `drizzle-kit push` it: `push` has shipped a bug that drops the operator class from the DDL even when the schema declares it correctly ([source](https://github.com/drizzle-team/drizzle-orm/issues/5792)) — `pnpm db:generate` + `pnpm db:migrate` is the only legitimate path in this repo regardless (`server/AGENTS.md`).
