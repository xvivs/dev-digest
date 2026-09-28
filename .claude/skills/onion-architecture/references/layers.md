# Layers — what goes where

One section per ring, from the core outward. Every "Bad" example is real code
in this repo today (frozen in the baseline) unless marked hypothetical.

The rule behind all of them is the Dependency Rule: source code dependencies
point only inward, and nothing in an inner circle knows the name of anything
in an outer one ([source](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html);
[source](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)).

## Domain — `domain.ts`, `constants.ts`, `types.ts`

Holds: the entity shape the service works with, value rules (invariants) as
pure functions, module-specific errors (`extends AppError`), literals.

- No I/O and no `container`. A domain function is testable with no setup at all.
- Types from `@devdigest/shared` are allowed as `import type` only (shared
  kernel, see `zod.md`).
- Behaviour belongs here when it is a rule about the data, not about storage or
  transport. If `domain.ts` holds only interfaces while `service.ts` holds every
  `if`, the model is anemic ([source](https://martinfowler.com/bliki/AnemicDomainModel.html)).

```ts
// Good — invariant is a pure function; the service calls it
export function normalizeExampleName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > EXAMPLE_NAME_MAX) throw new InvalidExampleNameError(raw);
  return name;
}
```

`constants.ts` is domain too, so another module reaching for it is still a
cross-module import: `modules/repos/service.ts:14` → `../repo-intel/constants.js`
(baseline). Shared literals go to `_shared/` or behind the container.

## Mapper — `helpers.ts`

Holds: pure row ⇄ domain/DTO transforms and small pure rules.

- Row types (`db/rows.ts`, `typeof t.x.$inferSelect`) are allowed **as
  `import type` only**.
- Bad: `modules/repos/helpers.ts:2` imports `* as t from '../../db/schema.js'`
  (a runtime import) just to write `typeof t.repos.$inferSelect`. Use
  `import type { RepoRow } from '../../db/rows.js'` (add the alias there if it
  is missing).

## Ports — `ports.ts`

Holds: the interfaces the service needs from the outside (store, clock, a
narrowed adapter). Declared by the inner ring and implemented by the outer
one ([source](https://alistair.cockburn.us/hexagonal-architecture/);
[source](https://github.com/Sairyss/domain-driven-hexagon)).

- Describe what the use case needs, not what Drizzle can do: `findByName`,
  not `select(where)`.
- Include `transaction(work)` when a use case must be atomic (`drizzle.md`).
- For an adapter that already has an interface in `@devdigest/shared`
  (`GitHubClient`, `LLMProvider`, …), do not redeclare it. Take that type, or a
  `Pick<>` of it, in the service constructor.
- No port for a pure CRUD passthrough (`anti-patterns.md`).

## Application — `service.ts`

Holds: use cases. One public method per scenario, command or query, not both
([source](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/)).
It also owns transaction boundaries.

- The constructor takes ports: `constructor(private readonly store: ExampleStore)`.
- Returns domain objects. DTO shaping belongs to the route.
- Bad (baseline, every existing service): the service builds its own
  infrastructure, so it cannot run without Postgres —
  ```ts
  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);   // modules/agents/service.ts
  }
  ```
  Good: `new AgentsService(new AgentsRepository(container.db))` in `wiring.ts`.

## Infrastructure — `repository.ts`, `repository/*.repo.ts`, `repo-intel/pipeline/*`

Holds: Drizzle queries and row → domain mapping. Implements a port when one
exists.

- The only module files that import `drizzle-orm` or runtime `db/**`.
- Never reaches up into `service.ts`, `routes.ts` or `wiring.ts`.
- Read models for the UI (join → DTO) are fine here without domain objects
  (`drizzle.md`, CQRS-lite).
- `src/adapters/**` is infrastructure too, outside the module. Only
  `platform/container.ts` constructs it; adapters never import a module (the
  baseline has two: `adapters/astgrep/index.ts` and `adapters/depgraph/index.ts`
  → `repo-intel/constants.ts`).

## Composition — `wiring.ts` and `platform/container.ts`

The Composition Root composes the object graph as close as possible to the
entry point, and only there
([source](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)). Here it has two levels:

| Level | File | Builds |
|---|---|---|
| App | `platform/container.ts` | adapters (lazy getters; no key → no client), shared repos |
| Module | `modules/<name>/wiring.ts` | `new XService(new XRepository(container.db), …)` |

A plain function is enough: no DI library
([source](https://khalilstemmler.com/articles/software-design-architecture/coding-without-di-container/)).

## Presentation — `routes.ts`, job handlers

Holds: the HTTP contract (zod `params`/`body` on the route), tenancy
(`getContext`), one service call, the DTO mapping.

- Bad (baseline): `modules/pulls/routes.ts` runs 18 `container.db` queries and a
  five-step non-atomic write (`:256-290`); `polling/routes.ts` syncs PRs from
  GitHub inside the handler.
- A handler that needs more than ~10 lines between `getContext` and `return`
  is hiding a use case. Move it to the service.

## Placement cheat sheet

| I am writing… | It goes in |
|---|---|
| a `select`/`insert`/join | repository |
| an `if` about business data | domain (pure rule) or service (orchestration) |
| "check then write" | service, inside `store.transaction` |
| zod schema of a request | routes.ts (or `@devdigest/shared` if the client needs it) |
| snake_case DTO for the response | routes.ts (`toDto`) |
| row → domain conversion | repository (private) or helpers.ts |
| a call to GitHub/LLM/git | service, via a port or adapter type injected by wiring.ts |
| a new adapter | `src/adapters/<name>/` + a getter in `platform/container.ts` |
| long-running work | `container.jobs` handler → service |
