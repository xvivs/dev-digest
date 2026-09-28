# Anti-patterns and pragmatic compromises

Where the layer map in `SKILL.md` says *how* the rings connect, this file says
*how much of them a given module actually needs* — and where the team has
already chosen to stop short of the textbook version.

## 1. Decide the depth first

Pick the row before writing a file. Going one row further than the module's
profile needs is itself the first anti-patern below.

| Module profile | Required files | Why |
|---|---|---|
| **Pure CRUD passthrough** (e.g. `workspace`: one 18-line read, `src/modules/workspace/routes.ts:16-33`) | `routes.ts` + `wiring.ts` + `service.ts` (thin pass-through) + `repository.ts`. No `ports.ts`, no `domain.ts`. | `presentation-no-infra` has no type-only exemption (rule `presentation-no-infra`), so `routes.ts` can never see `repository.ts` — `service.ts` must exist structurally even with zero logic. A port doesn't: `application-no-infra` exempts type-only imports (rule `application-no-infra`), so `service.ts` can type-only reference the concrete repository class directly. |
| **Reads for UI** (list/detail joins, no writes) | Same four files; `repository.ts` may return a join→DTO read model instead of the domain type (CQRS-lite). | A read path has no invariant to protect. Rule 12 (SKILL.md) lets reads bypass the domain model, but only inside the repository — never in `routes.ts`. |
| **Logic with branches or invariants** (name normalization + uniqueness, like the template) | + `ports.ts` (or `Pick<Repo, 'a' \| 'b'>`) + `domain.ts` + in-memory fake + hermetic unit test. | Plan §2.3 criterion: a port earns its cost exactly when there is a rule worth testing without Postgres — see `normalizeExampleName` + `ExampleNameTakenError` (`templates/module/domain.ts:27-45`). |
| **Multi-step writes** (check-then-insert, cascade delete) | + `store.transaction(work)`, owned by `service.ts`. | Without it you get exactly the bug already in the codebase: `deleteAgentRun` runs two unrelated `db.delete()` calls with no transaction and orphans rows on partial failure (`server/src/modules/reviews/repository/run.repo.ts:92-105`). |
| **Orchestration of external adapters** (GitHub sync, LLM review run) | + adapter reached through `container.*` (already lazy-constructed per `server/AGENTS.md`); long work via `container.jobs`, never inline in the request. | `container.github()`/`container.llm()` need the same fakeability as a DB port, and a slow external round-trip must not block the request thread — `JobRunner`'s 120s timeout exists for this. |

## 2. Anti-patterns

#### Overengineering CRUD
**Symptom here:** giving `workspace` (`src/modules/workspace/routes.ts`, a single read with no invariant) a `domain.ts` + `ports.ts` + fake it will never need to test.
**Fix:** stop at the "pure CRUD passthrough" row above.
**Source:** Sairyss — *"not recommended for small-medium sized applications with not a lot of business logic"* ([source](https://github.com/Sairyss/domain-driven-hexagon)).

#### Interface-per-class
**Symptom here:** a `*Store` port with exactly one Drizzle implementation and no fake, added to a module with no branching to isolate.
**Fix:** add `ports.ts` only when the "logic with branches or invariants" row applies — not as a reflex for every repository.
**Source:** Sairyss — *"Abusing ports/interfaces may lead to unnecessary abstractions and overcomplicate your application"* ([source](https://github.com/Sairyss/domain-driven-hexagon)).

#### Value object per primitive
**Symptom here:** wrapping every plain field — `name`, `system_prompt` in `src/modules/agents/service.ts:25-36` — in its own VO class instead of a trim/length check.
**Fix:** a VO only where a real invariant lives; otherwise a pure normalize function in `domain.ts`, as the template's `normalizeExampleName` does (`templates/module/domain.ts:27-33`).
**Source:** Sairyss overengineering section ([source](https://github.com/Sairyss/domain-driven-hexagon)).

#### Anemic domain model
**Symptom here:** `src/modules/agents/service.ts` has no `domain.ts`; the same `if (!agent) return undefined` guard is copy-pasted at lines 118, 133, 154 and 167 instead of living as one domain rule, and the service constructs its own repository (`service.ts:55` — a live `application-no-infra` baseline violation, frozen in `.dependency-cruiser-known-violations.json`).
**Fix:** don't retrofit `agents` wholesale; any *new* agents rule goes into a `domain.ts`, not another copy of the same guard in `service.ts`.
**Source:** Fowler — *"If all your logic is in services, you've robbed yourself blind"* ([source](https://martinfowler.com/bliki/AnemicDomainModel.html)).

#### Smart routes
**Symptom here — existing debt:** `src/modules/pulls/routes.ts` (398 lines, 18× `container.db`) builds "latest review per PR" (`:139`) and "latest run per PR" (`:187`) maps inline; `src/modules/polling/routes.ts:20-67` runs the entire GitHub-sync-and-upsert loop in the handler with no `service.ts`/`repository.ts` at all.
**Fix:** per the `SKILL.md` "Change" workflow — don't grow this debt. New logic added to these modules gets a real `service.ts`/`repository.ts`, even if the rest of the file stays as-is.
**Source:** Stemmler — *"Organizing App Logic with the Clean Architecture"* ([source](https://khalilstemmler.com/articles/software-design-architecture/organizing-app-logic/)).

#### Leaking rows ($inferSelect beyond infra)
**Symptom here:** `src/modules/reviews/run-executor.ts:58` and `:141` take `repo: typeof schema.repos.$inferSelect` as a function parameter — a raw Drizzle row type outside `repository.ts`/`helpers.ts`.
**Fix:** pass the mapped domain/DTO type instead; row types stay inside infrastructure and the mapper (rule 8).
**Source:** Stemmler — DTOs, Mappers & the Repository Pattern ([source](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/)).

#### Transaction in route
**Symptom here:** no route does this today (`grep -rn "transaction(" src` is otherwise empty), but a check-then-write dropped straight into a handler is the failure mode rule 9 exists to prevent — see the real, unwrapped version at `deleteAgentRun` (`src/modules/reviews/repository/run.repo.ts:92-105`).
**Fix:** the transaction boundary is always `store.transaction(work)`, owned by `service.ts` (`templates/module/service.ts:21-28`), never `routes.ts` and never a memoized container getter.
**Source:** Fowler, Unit of Work ([source](https://martinfowler.com/eaaCatalog/unitOfWork.html)); Drizzle, Transactions ([source](https://orm.drizzle.team/docs/transactions)).

#### Domain error carrying HTTP details beyond statusCode
**Symptom here:** widening a domain error's `details` with response-shape concerns (headers, request id) instead of plain data — the template errors only ever carry `{ raw }` / `{ name }` (`templates/module/domain.ts:37,43`).
**Fix:** `AppError` (`server/src/platform/errors.ts:7-16`) stays data-only; only `setErrorHandler` in `app.ts` turns `statusCode` into an actual response (rule 10).
**Source:** Sairyss — a domain error should not know what context it runs in, HTTP, CLI or queue ([source](https://github.com/Sairyss/domain-driven-hexagon)).

#### "Cleaning up" lesson scaffolding
**Symptom here:** deleting or wiring up empty tables, unused i18n files, `T1`/`T2`/`T3` tags, or `server/src/platform/model-router.ts` / `prompts.ts` while doing an onion pass, because they look unfinished.
**Fix:** leave them. Out of scope by explicit project rule, not an oversight.
**Source:** root `AGENTS.md:5-6` — *"Empty tables, unused i18n files and T1/T2/T3 tags are deliberate scaffolding. Do not 'clean them up'"*.

## 3. Pragmatic compromises we accept

- **Shared kernel types.** `import type` from `@devdigest/shared` is allowed everywhere, including `domain.ts`; runtime `.parse()`/schema instances stay confined to `routes.ts` (plan §2.2 B, `server/specs/onion-architecture-skill.md:63-67`). Avoids duplicating every contract and sidesteps the zod duplicate-instance bug already known in `app.ts`.
- **`AppError` carries `statusCode`.** A purist domain error wouldn't know about HTTP at all; this codebase's existing taxonomy already threads `statusCode` through `AppError → NotFoundError/ValidationError/ExternalServiceError/ConfigError` (`server/src/platform/errors.ts:7-40`), and only `setErrorHandler` reads it. Rewriting the taxonomy is out of scope — `statusCode` alone doesn't leak response shape the way the anti-pattern above does.
- **Hand-written `Container`, no DI library.** `platform/container.ts` composes plain objects; no InversifyJS/awilix. Right-sized for an 8-module, no-workspace repo ([source](https://khalilstemmler.com/articles/software-design-architecture/coding-without-di-container/)).
- **Flat files until the threshold.** Plan §2.1 chose flat `domain.ts`/`service.ts`/… over `domain/ application/…` subfolders — zero migration cost for the modules that don't need it yet (see §4 for when that changes).
- **Baseline instead of big-bang refactor.** `.dependency-cruiser-known-violations.json` + `arch:check --ignore-known` (`server/package.json:11-12`) freezes today's violations — e.g. `agents/service.ts → agents/repository.ts` (`application-no-infra`) is already in that file — so CI blocks only new drift. `pulls`/`polling`/`settings`/`workspace` get fixed as their own tickets, not folded into this skill.

## 4. When to switch to subfolders

**Threshold (plan §2.1):** a module moves from flat files to canonical
subfolders once its `service.ts` exceeds **~400 lines**, or it grows **more
than two use-case files**. Nothing has crossed it yet, but `pulls/routes.ts`
is already 398 undifferentiated lines (`src/modules/pulls/routes.ts`) — the
day that logic lands in a real `service.ts`, it starts right at the line.

**Target layout:** `domain/`, `application/`, `infrastructure/`,
`presentation/`, holding the same file roles as folders instead of flat files
(`application/service.ts` + `application/ports.ts`, `infrastructure/repository.ts`, etc.).

**Same-MR requirement:** `.dependency-cruiser.cjs`'s layer constants match by
flat filename (`DOMAIN`, `APPLICATION`, `INFRA`, … at the top of `.dependency-cruiser.cjs`).
A module moved into subfolders without updating those regexes in the same MR
silently drops out of every `from`/`to` match in `forbidden` — `arch:check`
stays green while no longer checking that module at all.
