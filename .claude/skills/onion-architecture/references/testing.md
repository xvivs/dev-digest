# Testing — the pyramid per ring

Package-wide conventions (suite map, CI split, `test/helpers/pg.ts`) live in `TESTING.md` at the repo root — this file covers only which ring gets which kind of test once a module has ports.

## Naming rule

A DB-backed test MUST end in `*.it.test.ts`, or the CI unit/integration split breaks: the unit lane runs `vitest run --exclude '**/*.it.test.ts'`, the integration lane runs `vitest run .it.test` (`TESTING.md:67-68`, naming rule at `TESTING.md:79-82`). Any file that imports `test/helpers/pg.ts` (testcontainers) without that suffix passes locally and fails in CI, which has no Docker for the unit lane.

## Domain — pure unit tests

Plain `describe`/`it` against exported functions from `domain.ts`. No fixture, no mock, no `container`. Must NOT: construct a `Container`, import `drizzle-orm` or `db/**`, or need `beforeEach` setup beyond building a value — if it does, the function under test likely isn't pure.

## Service — in-memory fake of the port

Hermetic, lives at `server/test/<name>-service.test.ts` — NOT `*.it.test.ts`, no Docker (`templates/module/service.test.ts:1-5`). The fake implements the whole port, including `transaction`:

```ts
// templates/module/service.test.ts:17-38 (trimmed)
class InMemoryExampleStore implements ExampleStore {
  rows: Example[] = [];
  async findByName(workspaceId: string, name: string) { /* … */ }
  async insert(input: NewExample) { /* … */ }
  transaction<T>(work: (store: ExampleStore) => Promise<T>): Promise<T> {
    return work(this);           // no tx, no savepoint — just runs on itself
  }
}
```

Must NOT: import `drizzle-orm`, `db/**`, or `Container` — a fake that needs the DI container to build itself is testing the wrong ring. Assert on the domain object the service returns, not on a row shape.

## Repository — contract tests as `*.it.test.ts`

Real Postgres via `test/helpers/pg.ts::startPg()` — spins `pgvector/pgvector:pg16`, runs real migrations, returns a `Db` bound to the container (`test/helpers/pg.ts:35-43`). Self-skips when Docker isn't reachable, the pattern every `*.it.test.ts` in this repo follows:

```ts
// test/reviews.it.test.ts:12-13
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```

Must NOT: assert on HTTP status codes or route/DTO shapes — that belongs to the route/contract tier. Drives the repository class directly against the real `Db`.

## Route / contract — `buildApp` + `inject`

HTTP-only concerns: status codes, zod validation errors, DTO field names, SSE framing. Build the app with mock adapters, hit it with `inject`:

```ts
// test/reviews.it.test.ts:113-125 (trimmed)
function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
  return buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }),
      llm: { [provider]: new MockLLMProvider(provider, { structured }) } },
  });
}
```

Must NOT: replace `db` with a fake — the point of this tier plus the repository tier together is a real SQL round trip end to end.

**Current gap.** No real module has adopted `ports.ts` yet — `modules/agents/service.ts` → `modules/agents/repository.ts` is a frozen `application-no-infra` baseline violation (`.dependency-cruiser-known-violations.json:30-43`) — so today's `*.it.test.ts` files exercise repository and route together through one `buildApp`+`inject` suite (`test/reviews.it.test.ts`). A module built from `templates/module/` splits that into a repository contract test plus a service unit test plus a thinner route test.

## Layer table

| Layer | Test file | Docker? | Proves |
|---|---|---|---|
| domain | `test/<name>.test.ts` (or colocated `src/**/*.test.ts`) | no | invariants, pure rules |
| service | `test/<name>-service.test.ts` | no | orchestration + transaction boundary, against a fake port |
| repository | `test/<name>-repository.it.test.ts` | **yes** | real SQL, joins, migrations, tenancy scoping |
| route/contract | `test/<name>.it.test.ts` (or a hermetic route smoke test) | yes / no | HTTP surface: status, validation, DTO shape |

## Fake vs mock

Prefer a hand-written fake implementing the port (`InMemoryExampleStore`) over `vi.mock()`-ing a module. A fake is typed against the same interface the Drizzle repository implements, so it breaks at compile time the moment the port's shape changes; a `vi.mock('./repository.js')` only breaks at run time, if the mocked call shape happens to diverge, and it re-couples the test to the module's file layout instead of its port ([source](https://dev.to/tacoda/hexagonal-architecture-in-practice-ports-adapters-and-tests-that-skip-the-database-5b19)). Reach for `src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`, `MockEmbedder`) only for the adapters that already ship a shared mock — don't hand-roll a second one per test file ([source](https://docs.docker.com/guides/testcontainers-nodejs-getting-started/); [source](https://dev.to/gabrielanhaia/the-testing-pyramid-for-hexagonal-php-unit-the-core-contract-the-ports-5e76)).
