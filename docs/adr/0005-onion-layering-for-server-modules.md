# ADR 0005 — Onion layering for server modules, checked by dependency-cruiser

**Status:** accepted
**Date:** 2026-09-28

## Context

`server/AGENTS.md` already states layering rules: modules never import each
other, services hold no SQL, only the container constructs adapters. Nothing
checks them, and the code has drifted:

- `pulls`, `polling`, `settings` and `workspace` have no service or repository.
  Their Drizzle queries run inside `routes.ts`; `pulls/routes.ts` alone makes 18
  `container.db` calls, including a five-step write with no transaction
  (`:256-290`).
- Every service that exists builds its own repository
  (`this.repo = new AgentsRepository(container.db)`), so no service can be
  unit-tested without Postgres. The hermetic suite covers pure helpers only.
- No production code calls `db.transaction(`. `deleteAgentRun`
  (`reviews/repository/run.repo.ts:92-105`) deletes two tables in two
  independent queries, although its own comment says they must go together.
- `repos/service.ts:14` imports another module's constants, and two adapters
  import `repo-intel/constants.ts`.

Lessons L03–L08 add a module each. Agents write most of that code, and an
agent copies whatever pattern the nearest module shows. Without a gate, the
debt spreads with every lesson.

## Decision

1. **Onion layering inside each module, by file role** (flat files, no
   subfolders):
   `domain.ts`/`constants.ts`/`types.ts` (domain) ← `ports.ts` + `service.ts`
   (application) ← `repository.ts` (infrastructure, implements the port),
   `routes.ts` (presentation), `wiring.ts` (module composition root).
   `helpers.ts` is a pure mapper that may import row types only.
2. **Shared kernel:** types from `@devdigest/shared` may be imported
   (`import type`) in every ring. Runtime zod stays at the edges. ADR 0001
   keeps the contracts vendored and unchanged.
3. **Ports only where they pay:** a service with branching or invariants gets a
   port, an in-memory fake and a hermetic test. A CRUD passthrough does not.
4. **Transactions through the port:** `store.transaction(work)`. The Drizzle
   repository implements it as `db.transaction((tx) => work(new Repo(tx)))`.
   The service owns the boundary and stays DB-free.
5. **Machine check:** `server/.dependency-cruiser.cjs` forbids the outward and
   cross-module edges. `pnpm arch:check` runs locally and as a step of the
   `typecheck` job in `server-unit.yml`. The 19 current violations are frozen in
   `.dependency-cruiser-known-violations.json`, and only new ones fail.
6. **Agent guidance:** the `onion-architecture` skill
   (`.claude/skills/onion-architecture/`) carries the layer map, the rules,
   templates that compile and pass the gate, and the sources.

## Consequences

### What this enables

- A new module starts from templates that already pass the gate and ship a
  fake-based unit test.
- Services become testable without Docker once they take a port.
- A reviewer sees a layering violation as a CI failure with a rule name, not
  as a judgment call.

### What this costs

- Two more files per module with logic (`ports.ts`, `wiring.ts`), and a mapper
  per repository.
- Layers are recognised by file name, so a file with an unrecognised name
  (`run-executor.ts`, `diff-loader.ts`) gets only the module-wide rules.
- The baseline stores resolved `node_modules/.pnpm/<pkg>@<version>` paths. A
  drizzle-orm or postgres bump must re-run `pnpm arch:baseline`, or CI fails on
  four old entries.
- Legacy modules stay non-compliant until someone migrates them. The baseline
  shows the debt but does not pay it off.

### What this forbids

- New SQL in a route, a new runtime import of a repository from a service, and
  new cross-module imports.
- Regenerating the baseline to hide a new violation. It is regenerated only
  after an MR that removes entries, or for the version-bump case above.
- Business invariants inside `.refine()` of a contract schema.

## Alternatives considered

| Option | Why not |
|---|---|
| **Subfolders per ring** (`domain/ application/ infrastructure/ presentation/`) | Clearer tree and simpler regexes, but it forces a migration of all eight modules and is pure boilerplate for `workspace` (34 lines). Deferred: a module switches when `service.ts` passes ~400 lines or holds more than two use cases. |
| **Own domain types, no zod types in the core** | A "purer" core, at the cost of duplicating every vendored contract and a third copy that drifts. ADR 0001 already accepts the drift risk of two. |
| **Interface for every repository** | The "interface per class" anti-pattern: cost without a test that uses it. |
| **eslint-plugin-boundaries / `no-restricted-imports`** | No package has ESLint, and neither tool captures the module group, so "not another module" becomes N×N zones. |
| **TS project references / Nx boundaries** | Both need split tsconfig projects or a workspace. The repo is four standalone packages. |
| **AsyncLocalStorage transactions** | Not in Drizzle core (discussion #2777, issue #543), and it hides the boundary from the reviewer. |
| **awilix / fastify-awilix** | The hand-written `Container` is typed, lazy and already supports test overrides. A DI library would add a dependency without removing a problem. |

## Revisit when

- The baseline reaches zero. Then drop `--ignore-known` from CI.
- A module outgrows flat files. Switch it to subfolders and extend the regexes
  in the same MR.
- A second database or a Postgres-free test tier becomes a goal. Then a full
  Unit of Work port may replace the per-store `transaction` method.
