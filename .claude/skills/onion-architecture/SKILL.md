---
name: onion-architecture
description: "Onion Architecture for DevDigest server modules (Fastify 5 + Drizzle + zod). Use when creating, changing, reviewing or refactoring anything under server/src/modules — a route, service, repository, port, job handler or a whole module; when deciding where business logic, SQL, validation, DTO mapping or a transaction goes; when an import crosses a layer or another module; or when pnpm arch:check fails."
---

# Onion Architecture (DevDigest server)

Where code lives inside `server/src/modules/<name>/`, which way dependencies
point, and how the rules are checked by machine. *How* to write a Fastify
route, a Drizzle query or a zod schema is covered by `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design` and `zod`. This skill decides
**where** that code goes and does not repeat them.

Source of truth: `server/AGENTS.md` and `docs/adr/0005-onion-layering-for-server-modules.md`.
If they and this skill disagree, they win: flag the drift instead of picking
silently. `reviewer-core/` is the reference for a pure core (no I/O, one
injected `LLMProvider`).

## The layer map

Dependencies point **inward only**. Outer rings know inner ones, never the
reverse.

```
routes.ts · job handlers      presentation — driving adapters (Fastify, JobRunner)
  └─ wiring.ts                composition — builds service + concrete repository
       └─ service.ts          application — use cases, transaction boundaries
            ├─ ports.ts       application — interfaces the service needs
            └─ domain.ts      domain — entities, invariants, domain errors (+ constants.ts, types.ts)
repository.ts · repository/   infrastructure — implements ports with Drizzle (+ helpers.ts mappers)
platform/container.ts         app composition root — the only place adapters are constructed
```

| Layer | File(s) | May import | Must not import |
|---|---|---|---|
| Domain | `domain.ts`, `constants.ts`, `types.ts` | other domain files, `import type` from `@devdigest/shared`, `platform/errors.ts` | `db/**`, `drizzle-orm`, `fastify`, `container`, `adapters/**`, any outer file |
| Mapper | `helpers.ts` | domain, **type-only** row types | runtime `db/**` / `drizzle-orm` / `container` / `adapters/**`, service, routes |
| Ports | `ports.ts` | domain | everything else |
| Application | `service.ts` | domain, ports, `import type` of `Container` / `Db` | `drizzle-orm`, runtime `db/**`, `fastify`, repository (runtime), routes |
| Infrastructure | `repository.ts`, `repository/*`, `repo-intel/pipeline/*` | domain, ports, `drizzle-orm`, `db/**` | service, routes, wiring |
| Composition | `wiring.ts` | service, repository, `Container` | — |
| Presentation | `routes.ts` | wiring, domain (types, errors), `_shared/*`, zod, `fastify` | `drizzle-orm`, `db/**`, repository |

Across modules: **a module never imports another module.** Shared data goes
through `container.agentsRepo`, `container.reviewRepo`, `container.repoIntel`;
shared HTTP helpers go through `modules/_shared/`.

Full per-layer rules with good/bad examples: [references/layers.md](references/layers.md).

## Hard rules

Each rule marked ⚙ is enforced by `server/.dependency-cruiser.cjs`. The rest
are review-only: `pnpm arch:check` cannot see them, so check them by hand.

1. ⚙ `routes.ts` is parse → service → DTO. No Drizzle, no `db/**`, no repository.
2. Business branching stays out of handlers. A route may only turn a service's
   `undefined`/`false` into `NotFoundError`.
3. ⚙ `service.ts` has no SQL, no Fastify, and no runtime import of a repository.
   It gets a port through its constructor.
4. ⚙ Domain files are pure: no I/O, no container, no adapters, no runtime zod.
5. Invariants are pure functions in `domain.ts`, not `.refine()` on a contract schema.
6. ⚙ Modules never import each other (`_shared/` excepted).
7. ⚙ Only `platform/container.ts` constructs adapters. Only `wiring.ts` pairs a
   service with its repository.
8. Rows never leave infrastructure. The repository maps `$inferSelect` rows to
   domain types; routes map domain types to DTOs.
9. A multi-step write is one transaction, started by the service through
   `store.transaction(work)`. Never inside a route, never through a memoized
   container getter.
10. Domain errors extend `AppError` (`platform/errors.ts`). Only `setErrorHandler`
    in `app.ts` turns them into HTTP responses.
11. A service with logic has a port, an in-memory fake and a hermetic unit test.
    Every repository implementation has an `*.it.test.ts`.
12. Long work goes through `container.jobs`. A job handler is a driving adapter,
    as thin as a route.
13. ⚙ No runtime import cycles; indexer libraries (`@ast-grep`, `graphology`,
    `dependency-cruiser`, `js-tiktoken`) stay behind `container.repoIntel`.

Do not over-apply them: a pure CRUD passthrough needs no port and no
`domain.ts`. Decide the depth first: [references/anti-patterns.md](references/anti-patterns.md).

## Workflows

### Build: a new module or endpoint

1. Pick the depth from the decision table in `references/anti-patterns.md`.
2. Copy `templates/module/*.ts` into `server/src/modules/<name>/`, rename
   `Example`/`example`, and delete the files the depth does not need. The
   templates compile, pass `arch:check` and their test passes as shipped.
3. Write in this order: `domain.ts` → `ports.ts` → `service.ts` + the fake-based
   test (`templates/module/service.test.ts` → `server/test/<name>-service.test.ts`)
   → `repository.ts` + `*.it.test.ts` → `wiring.ts` → `routes.ts`.
4. Add the table to `src/db/schema/<domain>.ts` and run `pnpm db:generate`.
   Never hand-edit migrations.
5. Register the plugin in `src/modules/index.ts` (one import + one entry).
6. Run verification (below).

### Change: edit an existing module

1. Classify every file you touch using the layer map.
2. If the change needs an import the table forbids, **move the code to the
   right layer** instead of adding the import. SQL in a route moves to the
   repository; a rule in a route moves to the service or domain.
3. Legacy modules (`pulls`, `polling`, `settings`, `workspace`) have no
   service/repository yet. Do not grow the debt: new logic you add there goes
   into a new `service.ts`/`repository.ts`, even if the rest of the file stays
   put. Leave a full migration for its own task.
4. Never add to `.dependency-cruiser-known-violations.json` by hand, and never
   regenerate it to hide a violation you introduced.

### Audit: review a module or an MR

1. Run `cd server && pnpm arch:check` and report new violations.
2. Walk the review-only rules (2, 5, 8, 9, 10, 11, 12) over the diff.
3. Report as a table: `file:line | rule # | what is wrong | fix`, most severe first.
   Severity: **CRITICAL** = dependency points outward or a non-atomic
   multi-step write; **HIGH** = logic in the wrong ring (smart route, anemic
   service, invariant in `.refine`); **MEDIUM** = missing test or port for a
   service with logic.
4. Mention baseline violations only when the diff touches those lines.

## Verification (before saying "done")

```sh
cd server
pnpm typecheck
pnpm arch:check                                   # new layering violations → non-zero exit
pnpm exec vitest run --exclude '**/*.it.test.ts'  # hermetic suite, includes service tests
pnpm test                                         # full suite; needs Docker for *.it.test.ts
```

`pnpm arch:check` passing is necessary, not sufficient: it only sees imports.
The review-only rules still need a read of the diff.

## References

| File | Read when |
|---|---|
| [references/layers.md](references/layers.md) | placing any file or function; good/bad per layer |
| [references/fastify.md](references/fastify.md) | routes, wiring, error mapping, job handlers, route tests |
| [references/drizzle.md](references/drizzle.md) | repositories, row mapping, transactions, UI reads, pgvector |
| [references/zod.md](references/zod.md) | contract vs invariant, shared kernel, DTOs |
| [references/testing.md](references/testing.md) | which test per ring, fakes vs mocks, `*.it.test.ts` |
| [references/enforcement.md](references/enforcement.md) | `arch:check` failed, baseline, adding a rule, CI |
| [references/anti-patterns.md](references/anti-patterns.md) | deciding the depth; what not to do; when to switch to subfolders |
| [references/sources.md](references/sources.md) | where every rule comes from |
