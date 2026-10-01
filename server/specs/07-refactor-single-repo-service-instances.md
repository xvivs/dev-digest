# Refactor: one RepoIntelService and one RepoService per Container

**Status:** implemented (2026-10-01) · reviewed (3 rounds, clean) · **Branch:** `feat/overview-prepare` (uncommitted) · **Why:** each of `RepoIntelService` and `RepoService` is constructed twice per app (routes plugin + lazy container getter), so per-repo in-memory state had to sit in a module-scope `WeakMap<Container, …>` (ADR 0025). Any new per-repo field on either class silently splits. Code-review #7; the human decided to fix it in this PR.

> **Parallel work (finished, re-read 2026-10-01).** The gate / trailing-pass rework in `src/platform/keyed-gate.ts`, `repo-intel/service.ts`, `repo-intel/repository.ts`, `repos/service.ts` and `overview/service.ts` has landed; line numbers below are from that final state. `KeyedGate` now takes `(merge, logger?, dispatch?)` (`keyed-gate.ts:44-48`) and `settle` hands a trailing pass plus a fresh reservation to `dispatch` (`:119-140`); `IndexTrailing = {full, sync, workspaceId?}` OR-merged (`repo-intel/service.ts:123-126`); `dispatchTrailing(container, repoId, t, release)` enqueues each trailing pass as its own job on `container.jobs` (`:134-151`); `RepoService.refresh` no longer calls `requestIndex` (`repos/service.ts:168-175`). This plan touches **wiring only**. Sites marked **[OVERLAP]** sit inside functions the parallel work rewrote: the implementer re-greps the symbol before the step and stops if the shape differs from this plan.

## Target structure

| | Before | After |
|---|---|---|
| `platform/container.ts` | `get repoIntel()` → `overrides.repoIntel ?? (_repoIntel ??= new RepoIntelService(this))` (`:221-224`); `get repoClone()` → `overrides.repoClone ?? (_repoClone ??= buildRepoService(this))` (`:194-197`) | New `get repoIntelService(): RepoIntelService` (memoized, **ignores overrides**) and `get repoService(): RepoService` via `import type { RepoService } from '../modules/repos/service.js'` (memoized, ignores overrides; type-only edge, ignored by `no-circular`, `.dependency-cruiser.cjs:169-175`; no rule starts from `^src/platform/`). Both getters carry an `@internal` JSDoc: "only this module's `routes.ts`". `repoIntel` → `overrides.repoIntel ?? this.repoIntelService`; `repoClone` → `overrides.repoClone ?? this.repoService`. Fields `_repoIntel`/`_repoClone` replaced by `_repoIntelService`/`_repoService`. |
| `repo-intel/routes.ts` | `const service = new RepoIntelService(container)` (`:33`), registers handlers (`:34`), resync uses it (`:58`); runtime import of `./service.js` (`:22`) | `const service = container.repoIntelService`; same two uses; import of `./service.js` removed |
| `repos/routes.ts` | `const service = buildRepoService(app.container)` (`:21`), import of `./wiring.js` (`:6`) | `const service = app.container.repoService`; import removed |
| `repos/wiring.ts` | doc: "Used by the routes … and by `container.repoClone`; both share the module-scope clone gate" (`:1-6`) | doc: "`container.repoService` is the ONLY caller" (brief/wiring.ts:14-16 wording) |
| `repo-intel/service.ts` | `indexGates` WeakMap (`:106-112`) + `indexGateFor()` (`:153-164`, builds `new KeyedGate(mergeTrailing, {warn}, (repoId,t,release) => dispatchTrailing(container, …))`); uses at `:199` (`requestIndex`), `:215` (`getIndexReadiness`), `:244` (`runGated`) | `private readonly indexGate: KeyedGate<IndexTrailing>` set in the constructor with the **same three arguments**, closures over the constructor's `container`. `trailingFor`, `mergeTrailing`, `dispatchTrailing`, `IndexJobPayload` stay module-level and unchanged (stateless; `dispatchTrailing` keeps taking `container`) |
| `repos/service.ts` | `cloneGates` + `cloneGateFor()` (`:32-46`), `cloneFailures` + `cloneFailuresFor()` (`:48-62`); uses at `:79` (handler `runExclusive`, 3 args, no dispatch), `:85` (`runCloneJob`), `:129` (`enqueueClone`), `:190-191` (`getCloneStatus`) | `private readonly cloneGate: KeyedGate<never>` and `private readonly cloneFailures: Map<string, CloneFailure>`, both assigned in the constructor body (no class-field initialisers) |

Layers unchanged: container stays the composition root (it already runtime-imports `RepoIntelService`, `container.ts:40`, and `buildRepoService`, `:39`); The `import type { RepoService }` adds only a type-only edge; the container already reaches `repos/service.ts` through `repos/wiring.ts:9`. Routes stay presentation and resolve from the container (onion rule 7, AGENTS.md "Modules never construct adapters … resolve everything from the DI container").

### Why concrete getters and not the brief pattern

| Option | Handlers under `overrides.repoIntel` | Surface | Verdict |
|---|---|---|---|
| A. Concrete, override-free getters `repoIntelService` / `repoService`; facades delegate to them | Run on the real instance, as today (`repo-intel/routes.ts:33-34`) | Exposes the concrete class on `Container`; doc-comment restricts use to the owning module's `routes.ts` | **Chosen** |
| B. Brief pattern: handler closure resolves `container.prBrief` per call (`brief/wiring.ts:114-118`) | Handler would call the stub; `RepoIntel` has no `runGated`/`registerIndexJobHandlers` (`repo-intel/types.ts:175-218`), blast-routes fake has only two methods (`test/blast-routes.it.test.ts:82`) | Narrow | Changes behaviour under override. Rejected |
| C. `instanceof` check in routes (`container.repoIntel instanceof RepoIntelService ? … : new …`) | Real instance only without override; with override a second instance reappears | None | Re-creates the split. Rejected |

This is the case the comment at `repo-intel/routes.ts:28-32` describes: the local instance exists so handler registration does not depend on the facade.

## Behaviour inventory

| Surface | Consumers (path:line) | Pinned by | Status |
|---|---|---|---|
| `GET /repos/:id/index-state` → `container.repoIntel.getIndexState` | `repo-intel/routes.ts:35-44` | `test/overview-routes.it.test.ts` (indirect), `test/repo-intel-facade-degraded.test.ts:32` (service) | partial |
| `POST /repos/:id/resync` 202 shapes `{status:'accepted', jobId}` / `{…, coalesced:true}` / `{…, degraded:true, reason:'no_handler'}`; 404 foreign repo via `container.repoClone.getCloneStatus` | `repo-intel/routes.ts:46-62`; client hook | `overview-routes.it.test.ts:307` (404), `:315` (jobId); gate-level `repo-intel-index-gate.test.ts:112,132` | partial (coalesced, override routing unpinned) |
| Resync route uses the **real** instance even when `overrides.repoIntel` is set | `repo-intel/routes.ts:33,58` | none | unpinned |
| `POST /repos` 201/200, `GET /repos`, `POST /repos/:id/refresh` `{status:'refreshing'}`, `DELETE /repos/:id` `{deleted}` | `repos/routes.ts:26-47` | `overview-routes.it.test.ts:259` (refresh); I9 added | partial → pinned after step 0 |
| Repos routes use the real `RepoService` even when `overrides.repoClone` is set | `repos/routes.ts:21` | none (no test sets `overrides.repoClone`) | unpinned |
| Job kinds `clone`, INDEX, REFRESH, RESYNC registered exactly once per app; `JobRunner.register` is `Map.set`, last wins (`platform/jobs.ts:57-59`) | `repos/routes.ts:24`, `repo-intel/routes.ts:34` | none | unpinned |
| Handlers registered with `overrides.repoIntel` set | `blast-routes.it.test.ts:76-82` boots with the fake | none asserts it | unpinned |
| `container.repoIntel` / `container.repoClone` memoized; return override when given | `container.ts:194-197,221-224`; consumers `repos/service.ts:112` (clone follow-up; `refresh` no longer calls it, `:168-175`), `conventions/wiring.ts:31-32`, `blast/wiring.ts:23,46`, `overview/wiring.ts:24-25,29,45`, `reviews/run-executor.ts:524,557,580`, `repo-intel/routes.ts:43,53` | none | unpinned |
| Index gate shared by handler (`runGated`) and facade (`requestIndex`, `getIndexReadiness.inFlight`) | `repo-intel/service.ts:199,215,244` | `repo-intel-index-gate.test.ts:154` (via WeakMap, two raw instances); end to end `overview-routes.it.test.ts:233,255` | partial |
| Trailing pass dispatched as its own job on `container.jobs`, payload `{repoId, workspaceId, full?}`, run by the handler registered on that runner; key stays busy through the hand-off; dropped with a warn when `workspaceId` is missing | `repo-intel/service.ts:134-151`, `keyed-gate.ts:119-140` | `repo-intel-index-gate.test.ts:232,251,263,279,299` (stub container, one instance); no app-level test | partial |
| Clone gate + `cloneFailures` shared by handler (`registerCloneJobHandler`, `runCloneJob`) and facade (`getCloneStatus`, `requestClone`) | `repos/service.ts:79,85,129,190-191` | `repos-clone-gate.test.ts:94-226` (one instance only); no cross-instance test | partial |
| Gate dedupe AC-8..11 | spec 06 `:182-185` | `keyed-gate.test.ts:22-165`, `repo-intel-index-gate.test.ts:98-252`, `overview-routes.it.test.ts:233,255` | pinned |
| AC-26 clone `last_failure` | spec 06 `:198` | `repos-clone-gate.test.ts:151,168,187`, `overview-service.test.ts:190-204` | pinned (single instance) |
| Gate warn logger and `dispatchTrailing` resolve `container.logger` / `container.jobs` at call time (`app.ts:79` assigns the logger after `new Container`, `app.ts:75`) | `repo-intel/service.ts:135-150,158-159`, `repos/service.ts:42` | `keyed-gate.test.ts:146` (primitive only) | partial |
| Stub containers without `logger` construct services | `repos-clone-gate.test.ts:226-229` | that test | pinned |

## Characterization tests (step 0)

Hermetic file `server/test/container-repo-services.test.ts` builds `new Container({ secretsPath: '/nonexistent', repoIntelEnabled: true } as AppConfig, {} as Db, overrides)` (constructor has no I/O, `container.ts:123-132`). DB file `server/test/repo-services-singleton.it.test.ts` reuses the `startPg` + `seed` + `buildApp({config, db, overrides})` harness of `test/overview-routes.it.test.ts:43-80` and its `fixture()` shape (`:83-110`).

| ID | Test file | Surface | Input | Asserted current behaviour |
|---|---|---|---|---|
| H1 | `container-repo-services.test.ts` | getter identity | no overrides; read `c.repoIntel` twice, `c.repoClone` twice | `toBe` same object each pair |
| H2 | same | override passthrough | `overrides.repoIntel = fakeA`, `overrides.repoClone = fakeB` | `c.repoIntel === fakeA`, `c.repoClone === fakeB` |
| I1 | `repo-services-singleton.it.test.ts` | handler and facade share the index gate | cloned fixture; `vi.spyOn(app.container.git, 'sync')` returns a held deferred; `app.container.jobs.enqueue(ws, RESYNC_JOB_KIND, {repoId, workspaceId: ws})` directly (the payload shape `requestIndex` writes, `repo-intel/service.ts:203`) (test-only, bypasses the reservation so only the handler holds the key) | while held: `(await app.container.repoIntel.getIndexReadiness(repoId)).inFlight === true`; after release + `jobs.onIdle()`: `false` |
| I2 | same | handler and facade share the clone gate | `vi.spyOn(app.container.git, 'clone')` returns a held deferred; enqueue `clone` job directly | while held: `container.repoClone.getCloneStatus(ws, id).inFlight === true` |
| I3 | same | handler and facade share `cloneFailures` (AC-26) | `git.clone` rejects with `new Error('Repository not found')`; enqueue `clone`; `onIdle()` | `container.repoClone.getCloneStatus(ws,id).lastFailure.reason` equals what `classifyCloneFailure` returns today (record the observed value, do not hand-pick) |
| I4 | same | each kind registered exactly once | `vi.spyOn(JobRunner.prototype, 'register')` before `buildApp` | calls per kind on `app.container.jobs`: `clone`, INDEX, REFRESH, RESYNC each `=== 1` |
| I5 | same | override does not break registration (repoIntel) | `overrides.repoIntel = { getIndexState, getBlastRadius, requestIndex: vi.fn() }` cast (blast-routes shape) | `POST /repos/:id/resync` own repo → 202 `{status:'accepted', jobId}`, the fake's `requestIndex` **not** called, one RESYNC row in `jobs` |
| I6 | same | override does not break registration (repoClone) | `overrides.repoClone = { getCloneStatus: vi.fn(async () => undefined), requestClone: vi.fn() }` | `POST /repos/:id/refresh` own repo → 200 `{status:'refreshing'}` and one `clone` row (real service, handler registered); `POST /repos/:id/resync` → 404 (route reads the facade) |
| I7 | same | resync coalesce shape + trailing dispatch through the container's runner | two concurrent `POST /repos/:id/resync` with `git.sync` held, then release | responses: one `{status:'accepted', jobId}`, one `{status:'accepted', coalesced:true}`; `vi.waitFor`: two RESYNC rows in `jobs` for the repo, the second payload has `workspaceId === ws`, `git.sync` called twice, then `vi.waitFor(() => getIndexReadiness(repoId).inFlight === false)` (dispatch releases in `job.done.then`, after `onIdle` can resolve, `repo-intel/service.ts:148-150`) |
| I9 | same | `POST /repos` through the container's `RepoService` | `POST /repos` with a new GitHub URL, then the same URL again; `GET /repos`; `DELETE /repos/:id` | 201 then 200 with the same `id`; one `clone` row; `GET` lists it; `DELETE` returns `{deleted: id}` |
| I8 | same | trailing dispatch under `overrides.repoIntel` | override as in I5; two concurrent resyncs with `git.sync` held, release | responses as I7; `vi.waitFor`: two RESYNC rows, `git.sync` called twice; then poll the `jobs` table until every RESYNC row for the repo is `done`, `await new Promise((r) => setTimeout(r, 0))`, send exactly one third `POST /repos/:id/resync` and assert 202 `{status:'accepted', jobId}` (not `coalesced`), proving the real gate went idle; finish with `await jobs.onIdle()`. Never retry that POST: a coalesced retry records another trailing pass (`repo-intel/service.ts:200-201`). The fake's `requestIndex` is never called. No readiness call: the fake has no `getIndexReadiness`, and the real instance is unreachable at step 0 except through HTTP |

**Harness rules for I1-I8 (no races, no hangs).** `JobRunner` starts a handler only after an awaited `status:'running'` update (`platform/jobs.ts:84-88`), so a busy-check right after `enqueue` can read idle on untouched code. Every held spy is `vi.spyOn(app.container.git, 'sync' | 'clone').mockImplementationOnce(held)`, where `held` resolves an `entered` deferred on entry and then awaits a `release` deferred; later calls fall through to `MockGitClient` (`src/adapters/mocks.ts:281-291`), so the trailing RESYNC in I7/I8 does not hang. The test awaits `entered` before any "while held" assertion, and awaits `app.container.jobs.onIdle()` (plus `vi.waitFor` for dispatched trailing rows) before it ends. I4 counts only `register.mock.contexts` entries `=== app.container.jobs` (`evalJobs`/`briefJobs` share the prototype, `container.ts:129-131`).

**Retired in step 0:** `test/repo-intel-index-gate.test.ts:154` ("a second service instance on the same container shares the gate"). It pins the WeakMap mechanism this refactor removes by human decision; its observable intent (handler and facade see one gate) moves to the it-test I1. Removing it in step 0, not later, keeps the rule "no characterization test changes after step 0".

## Known quirks — preserved

- With `overrides.repoIntel`, `POST /repos/:id/resync` bypasses the override and goes to the real gate (`repo-intel/routes.ts:58`), while `GET …/index-state` uses the override (`:43`) and the clone follow-up uses the override (`repos/service.ts:112`).
- With `overrides.repoClone`, every `/repos*` route uses the real `RepoService`; only `resync`'s 404 check and `overview` read the stub.
- `JobRunner.register` silently overwrites (`jobs.ts:57-59`); nothing guards double registration.
- `POST /repos/:id/resync` returns 202 with `degraded:true` on any enqueue error, not only a missing handler (`repo-intel/routes.ts:54-61`).
- `INSIGHTS` citation `repo-intel/INSIGHTS.md:26` points at `container.ts:205-208`; the getter is at `:221-224`.

## Invariants (checked after every step)

- `cd server && pnpm typecheck` green.
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` green; `pnpm test` (Docker) green after steps 0, 3 and 5 at least, because the singleton tests are it-tests.
- Every step that names an I-test runs `pnpm exec vitest run test/repo-services-singleton.it.test.ts` and checks the reporter shows 0 skipped. A skipped suite is a failed verification.
- `grep -rnE "\.repoIntelService\b|\.repoService\b" server/src` → only `platform/container.ts`, `modules/repo-intel/routes.ts`, `modules/repos/routes.ts` (from step 3 on). Property access creates no import edge, so `arch:check` cannot see a misuse.
- `cd server && pnpm arch:check` green; `shasum .dependency-cruiser-known-violations.json` equals the value recorded at step 0 (the file is already modified in the working tree, so `git diff` is no reference).
- Both `src/vendor/shared` copies untouched (`git diff --quiet -- server/src/vendor client/src/vendor/shared` unchanged versus step 0).
- No migration, no change under `src/db/**`.
- No change to `RepoIntel` (`repo-intel/types.ts`) or `RepoCloneFacade` (`repos/types.ts`) or `ContainerOverrides`.
- Gate warn closures dereference `container.logger?.warn` at call time; never capture `container.logger` in the constructor.
- `grep -rnE "new RepoIntelService\(|buildRepoService\(" server/src` → only `platform/container.ts` and the definition `modules/repos/wiring.ts:11` (from step 3 on).

## Steps

0. **Characterization tests.** Add `test/container-repo-services.test.ts` and `test/repo-services-singleton.it.test.ts` as specified; delete the `it` at `test/repo-intel-index-gate.test.ts:154`. — verify: `pnpm exec vitest run test/container-repo-services.test.ts test/repo-intel-index-gate.test.ts` and `pnpm exec vitest run test/repo-services-singleton.it.test.ts` → green on untouched production code, **reporter shows I1-I9 passed, 0 skipped** (the harness skips without Docker, `test/overview-routes.it.test.ts:23-24`; if Docker is unavailable, stop and report) — rollback: delete the two files, restore the `it`.
1. **Introduce seam: concrete getters in the container.** `src/platform/container.ts`: add `_repoIntelService`/`_repoService`, getters `repoIntelService` and `repoService`; rewrite `repoIntel`/`repoClone` to `overrides.X ?? this.<concrete>`; delete `_repoIntel`/`_repoClone`; update both doc comments (`:189-193`, `:216-220`). — verify: invariants — rollback: revert `container.ts`.
2. **Swap repo-intel routes to the container instance.** `src/modules/repo-intel/routes.ts`: `const service = container.repoIntelService;` drop the `RepoIntelService` import; rewrite the comment at `:28-32` ("one instance per container; `repoIntelService` ignores overrides so handlers always run the real pipelines"). Header comment `:11-15` keeps its meaning. — verify: invariants + I1, I4, I5, I7, I8 — rollback: revert file.
3. **Swap repos routes to the container instance.** `src/modules/repos/routes.ts`: `const service = app.container.repoService;` drop the `buildRepoService` import. `src/modules/repos/wiring.ts:1-6`: doc comment only. — verify: invariants + I2, I3, I6, I9 — rollback: revert both files.
4. **[OVERLAP] Index gate → instance field.** `src/modules/repo-intel/service.ts`: move the body of `indexGateFor` (`:153-164`) into the constructor verbatim: `this.indexGate = new KeyedGate<IndexTrailing>(mergeTrailing, { warn: (obj, msg) => container.logger?.warn(obj, msg) }, (repoId, t, release) => dispatchTrailing(container, repoId, t, release))`. Replace every `indexGateFor(this.container)` with `this.indexGate` (`:199`, `:215`, `:244`); delete `indexGates` and `indexGateFor`; rewrite the doc block at `:106-111` (gate is per instance; the container holds one instance). `dispatchTrailing` keeps enqueuing on `container.jobs`, the runner the single instance registered its handlers on in step 2, so trailing jobs reach the same instance and its gate. Do not touch any other line of `requestIndex`, `runGated`, `trailingFor`, `mergeTrailing` or `dispatchTrailing`. — verify: invariants + `test/repo-intel-index-gate.test.ts`, `test/keyed-gate.test.ts`, I1, I7, I8 — rollback: revert file.
5. **[OVERLAP] Clone gate and clone failures → instance fields.** `src/modules/repos/service.ts`: constructor body sets `this.cloneGate = new KeyedGate<never>((a) => a, { warn: (obj, msg) => this.container.logger?.warn(obj, msg) })` and `this.cloneFailures = new Map()`; replace `cloneGateFor(this.container)` / `cloneFailuresFor(this.container)` everywhere (`:79`, `:85`, `:129`, `:190-191`); the clone gate keeps no `dispatch` argument (clones are never coalesced, `:32-36`); delete both WeakMaps and helpers; rewrite doc blocks `:32-36`, `:48-52`. Do not touch `refresh` or the `runCloneJob` follow-up block. Initialise in the constructor body, not as class fields: `target: ES2022` (`tsconfig.json:3`) defines fields before parameter properties are assigned. — verify: invariants + `test/repos-clone-gate.test.ts`, `test/repos-clone-failure.test.ts`, I2, I3 — rollback: revert file.
6. **Docs in code + module rule.** `src/modules/repo-intel/AGENTS.md` Rules: add "Never construct `RepoIntelService` or call `buildRepoService` outside `platform/container.ts`; per-repo state lives on the one instance the container holds." — verify: `pnpm arch:check` (no-op) — rollback: revert. Proposal for the `server/AGENTS.md` owner (next to the Rules bullet "Modules never import each other", `server/AGENTS.md:13`): *"A service that keeps in-memory state is built only by its container getter; routes resolve it from the container."* `repos/` has no AGENTS.md, so the generic rule is where a repos editor will see it. ADR 0025 amendment (below) and `INSIGHTS` updates are handed to `doc-writer` / `engineering-insights`, not done by the implementer.

### ADR 0025 amendment (text for doc-writer)

Append under **Status**: `amended 2026-10-01 by server/specs/07-refactor-single-repo-service-instances.md`.

Context, replace the paragraph starting "`RepoIntelService` exists twice per app": *"`RepoIntelService` and `RepoService` were each constructed twice per app (routes plugin and container getter). The refactor in spec server/07 left one instance of each per `Container`."*

Decision 2, replace the second and third sentences: *"One instance per concern, held as a private field of the service that owns it: `indexGate` on `RepoIntelService`, `cloneGate` on `RepoService`. The container holds exactly one instance of each (`container.repoIntelService`, `container.repoService`); `container.repoIntel` / `container.repoClone` return a test override or that instance. Job handlers register on the concrete instance, so a facade override never takes the handlers with it. Separate test apps get separate containers and so separate gates."*

Decision 3, replace "the clone job's follow-up and `RepoService.refresh` (both in `repos/service.ts`)" with *"the clone job's follow-up in `repos/service.ts` (`refresh` only enqueues a clone; its follow-up requests the index)"* (already stale after the gate rework, `repos/service.ts:168-175`).

Decision 7, replace "in `cloneFailures`, a `WeakMap` keyed by container" with *"in the `cloneFailures` field of the container's single `RepoService`"*.

Consequences → What this forbids, add: *"Constructing `RepoIntelService` or `RepoService` outside `platform/container.ts`. A second instance would get its own gates and clone failures."*

Alternatives, rename the chosen row to *"In-process `KeyedGate` per service instance, one instance per container (chosen)"*, and add a row: *"Module-scope `WeakMap<Container, KeyedGate>` (original choice) | Works with two instances per app | Hides the duplicate instances; any new per-repo field splits silently"*.

## Out of scope

- Any change to `KeyedGate`, `requestIndex`/`runGated`/`dispatchTrailing` logic, trailing payloads, `partialReason` in stats (`repo-intel/repository.ts:49`, `pipeline/incremental.ts:256`), `refresh`, the clone follow-up or overview facts (parallel work, landed).
- Making resync honour `overrides.repoIntel` (quirk, preserved).
- An arch rule forbidding `routes.ts → service.ts` constructors (open question).
- Route-level test of the `degraded:true` resync shape.
- Comment drift in `.dependency-cruiser.cjs:86` (`presentation-no-infra`: "routes.ts gets its service from wiring.ts"), already false for `brief`; propose a rewording alongside the `server/AGENTS.md` rule.

## Risks

1. **Steps 4-5 edit functions the parallel work just rewrote.** Mitigation: those steps are a symbol substitution; implementer re-greps `indexGateFor(` / `cloneGateFor(` / `cloneFailuresFor(` and expects exactly 3 / 3 / 2 call sites plus definitions; any other count means the code moved again and the step stops.
2a. **Trailing dispatch depends on handler location.** `dispatchTrailing` enqueues on `container.jobs` (`repo-intel/service.ts:149`); the job runs whatever handler is registered for that kind. Today that is the routes instance, which shares the WeakMap gate. After step 2 it is `container.repoIntelService`; after step 4 the gate is that instance's field. If step 4 ran before step 2, the routes instance would still dispatch to and run against its own gate consistently; what breaks is the facade (`container.repoIntel`: readiness, the clone follow-up `requestIndex`), which would see a second gate. I1 catches that; I7-I8 pin the dispatch path. Hence the order 1 → 2 → 3 → 4 → 5, with I1 and I7-I8 run after every step from 2.
2. **Concrete getters become a back door** for other modules to bypass test overrides. Mitigation: `@internal` JSDoc plus the grep invariant on `.repoIntelService` / `.repoService` (a property access has no import edge, so dependency-cruiser cannot enforce this).
3. **Eager gate construction captures a stale logger.** Mitigation: invariant on the lazy `?.warn` closure; `keyed-gate.test.ts:146` plus `repos-clone-gate.test.ts:226` (no `logger` on the stub).
4. **Hidden test reliance on two instances.** Only `repo-intel-index-gate.test.ts:154` found (investigator sweep of `test/**` for `new RepoIntelService(` / `new RepoService(`); retired in step 0.
5. It-tests need Docker; a hermetic-only run would miss I1-I8.

## Relevant INSIGHTS entries

- `server/src/modules/repo-intel/INSIGHTS.md:26` — the two-instance entry. It becomes false after step 5.
- `server/src/modules/repo-intel/INSIGHTS.md:40` — gate held in module scope (session note).
- `server/INSIGHTS.md:48` — memoized container getters are `db`-bound; unaffected (no transaction here).
- `server/INSIGHTS.md:56` — even type-only cross-module imports fail `arch:check`; the plan adds none.
- `server/INSIGHTS.md:74` — why the gate is in-process.
- `server/INSIGHTS.md:106` — `buildApp` per test; each gets its own Container.

## Open questions

- Q1 (non-blocking): add a dependency-cruiser rule "only `platform/container.ts` may runtime-import `repo-intel/service.ts` / `repos/wiring.ts`"? It would stop a routes file from constructing a second instance. It cannot stop other modules from reading `container.repoIntelService`; the grep invariant covers that.
- Q3 (non-blocking, naming): `repoService` vs `repoCloneService` to mirror the `repoClone` facade. Plan uses `repoService` (matches the class name).
- Q2 (approval): retiring `test/repo-intel-index-gate.test.ts:154` in step 0.

## Review log

| Round | Source | Finding | Sev | Resolution |
|---|---|---|---|---|
| 1 | coordinator | parallel gate work landed: 3-arg `KeyedGate`, `dispatchTrailing` on `container.jobs`, `IndexTrailing` object, `refresh` no longer requests index | — | Accepted: all change sites re-cited against the final code; inventory row for trailing dispatch; I7/I8 added; risk 2a on step order |
| 1 | plan-critic PC-1 / arch AR-1 | step 4 dropped the `dispatch` argument | CRITICAL / MEDIUM | Accepted: step 4 moves the 3-arg construction verbatim |
| 1 | plan-critic PC-2 | while-held asserts race job start; trailing sync hangs | MAJOR | Accepted: harness rules (`entered` deferred, `mockImplementationOnce`, `onIdle`) |
| 1 | plan-critic PC-3 | it-test skipped without Docker reads green | MAJOR | Accepted: 0-skipped check in every step's verify; stop without Docker |
| 1 | plan-critic PC-4 | stale line refs | MINOR | Accepted: re-cited |
| 1 | plan-critic PC-5 | ambiguous row numbers, register filter | MINOR | Accepted: IDs H1-H2, I1-I8; filter by `=== app.container.jobs` |
| 1 | arch AR-2 | getters guarded only by a comment | LOW | Accepted: `@internal` + grep invariant; Q1 reworded |
| 1 | arch AR-3 | repos rule in repo-intel AGENTS.md | LOW | Accepted: generic rule proposed for `server/AGENTS.md` |
| 1 | arch AR-4 | `ReturnType` rationale wrong | LOW | Accepted: `import type { RepoService }` |
| 1 | arch open q | naming `repoService` | — | Kept; logged as Q3 |
| 2 | arch | APPROVE, 0 findings; open q: ADR Decision 3 stale | — | Accepted: Decision 3 amendment text added |
| 2 | arch | `cloneFailures` init contradicts step 5 | — | Accepted: constructor body for both |
| 2 | plan-critic PC-4 | `repo-intel/routes.ts` refs off by one | MINOR | Accepted: re-cited (`:22,28-34,43,53,58`) |
| 2 | plan-critic PC-6 | I8 calls `getIndexReadiness` on a fake that lacks it | MAJOR | Accepted: I8 proves idle through a third `POST /resync` |
| 2 | plan-critic PC-7 | I7 idle check flakes after `onIdle` | MINOR | Accepted: `vi.waitFor` |
| 2 | plan-critic PC-8 | constructor grep matches `wiring.ts:11` | MINOR | Accepted: definition allowed explicitly |
| 2 | plan-critic PC-9 | baseline already dirty | MINOR | Accepted: `shasum` at step 0 |
| 2 | plan-critic PC-10 | wrong reason for step order | MINOR | Accepted: risk 2a rewritten |
| 3 | plan-critic | ACCEPT, 0 blocking | — | — |
| 3 | plan-critic PC-11 | I8 idle poll has side effects | MINOR | Accepted: poll `jobs` rows, one POST, no retry |
| 3 | plan-critic PC-12 | stale `routes.ts:42,52` | MINOR | Accepted: `:43,53` |
| 3 | plan-critic PC-13 | `POST/GET/DELETE /repos` unpinned | MINOR | Accepted: I9 |
| 2 | arch | `.dependency-cruiser.cjs:86` comment says routes get service from wiring | — | Accepted as proposal in Out of scope (comment only) |
| impl | refactor-implementer | Phase 1: 11 characterization tests (H1-H2, I1-I9), green on the untouched code | — | done |
| impl | refactor-implementer | Phase 2: steps 1-5 done; 937/937 tests pass, 0 skipped | — | done |
| impl | orchestrator | step 6 (rule in `repo-intel/AGENTS.md`) | — | pending: the orchestrator adds it |
