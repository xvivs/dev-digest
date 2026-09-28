# Enforcement — `pnpm arch:check`

The layering is checked by dependency-cruiser over `server/src`:

| File | Role |
|---|---|
| `server/.dependency-cruiser.cjs` | the rules (layer regexes + `forbidden`) |
| `server/.dependency-cruiser-known-violations.json` | baseline: legacy violations that do not fail the check |
| `server/package.json` → `arch:check`, `arch:baseline` | local commands |
| `.github/workflows/server-unit.yml` → job `typecheck`, step "Architecture gate" | CI (inlined `pnpm exec depcruise …`) |

Why dependency-cruiser, not ESLint or project references: it is already a
dependency, it runs per package without a workspace, and `$1` group matching
lets one rule cover every module
([source](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)).
ESLint is not set up in any package, and TS project references or Nx boundaries
would need a workspace this repo does not have.

It is **not** the same use as `src/adapters/depgraph/`, which calls
dependency-cruiser at runtime on *target* repos and never reads this config.

## Commands

```sh
cd server
pnpm arch:check       # fails (exit = number of new errors) on violations not in the baseline
pnpm arch:baseline    # rewrites the baseline — only after FIXING violations, never to hide one
./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --no-ignore-known --output-type err src   # full debt list
```

If `pnpm` tries to run `pnpm install` first (pnpm 11 deps-status check), call
`./node_modules/.bin/depcruise` directly.

## Rules

| Rule | Catches |
|---|---|
| `modules-no-cross-import` | `modules/a/**` → `modules/b/**` (except `_shared/`) |
| `presentation-no-db` | `routes.ts` → `db/**`, `drizzle-orm`, `postgres` |
| `presentation-no-infra` | `routes.ts` → repository |
| `application-no-db` | `service.ts` → runtime `db/**` / `drizzle-orm` (type-only allowed) |
| `application-no-infra` | `service.ts` → runtime repository (type-only allowed) |
| `application-no-fastify` | service/domain/mapper/infra → `fastify`, `fastify-type-provider-zod` |
| `application-no-presentation` | `service.ts` → `routes.ts` |
| `infrastructure-no-upward` | repository → service / routes / wiring |
| `domain-is-pure` | domain files → db, drizzle, container, adapters, any outer module file (even type-only) |
| `domain-no-runtime-zod` | domain files → runtime `zod` (type-only allowed; shared schema values are invisible, review-only) |
| `mapper-is-pure` | `helpers.ts` → runtime db / drizzle / container / adapters / service / routes |
| `only-container-constructs-adapters` | a module (not `repo-intel`) → runtime `src/adapters/**` |
| `repo-intel-libs-behind-facade` | a module (not `repo-intel`) → `@ast-grep`, `dependency-cruiser`, `graphology`, `js-tiktoken` |
| `adapters-no-modules` | `src/adapters/**` → `src/modules/**` |
| `no-circular` | runtime import cycles (cycles made only of `import type` are ignored) |

Layer membership is decided **by file name**. A file that matches no role
(`reviews/run-executor.ts`, `reviews/diff-loader.ts`, `pulls/status.ts`, …) is
only covered by the module-wide rules. When you add such a file, either name
it by role or extend the regex at the top of the config in the same MR.

## Reading a failure

```
error application-no-infra: src/modules/foo/service.ts → src/modules/foo/repository.ts
```

Rule name → the table above → fix the code, not the config:

| Rule | Usual fix |
|---|---|
| `presentation-no-db` | move the query into `repository.ts`, call it through the service |
| `application-no-infra` | accept a port in the constructor; build the repository in `wiring.ts` |
| `modules-no-cross-import` | use the container-hung repo/facade, or move the shared piece to `_shared/` |
| `mapper-is-pure` | `import * as t` → `import type { XRow } from '../../db/rows.js'` |
| `no-circular` | the value import usually belongs one ring further in; make it `import type` or move the shared bit down |

## Baseline

- **Adding** entries is allowed only by running `pnpm arch:baseline` after an
  MR that **reduces** the list, so the fixed entries drop out. Never hand-edit.
- The baseline stores resolved paths. Four `presentation-no-db` entries point at
  `node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/…`, so a
  drizzle-orm or postgres **version bump turns them into "new" violations** and
  fails CI. Re-run `pnpm arch:baseline` in the bump MR and check that the diff
  only renames those paths.
- Current debt (19 entries, 2026-09-28): `presentation-no-db` × 8 (`pulls`,
  `polling`, `settings`, `workspace`), `application-no-infra` × 6 (every
  service builds its own repository), `adapters-no-modules` × 2,
  `mapper-is-pure` × 1, `modules-no-cross-import` × 1,
  `only-container-constructs-adapters` × 1.

## Adding or changing a rule

1. Edit `server/.dependency-cruiser.cjs`. Keep `comment` actionable: it is
   printed on failure.
2. Prove it catches: drop a throwaway violating file into
   `src/modules/zz-probe/`, run `pnpm arch:check`, see the error, delete the
   folder.
3. Prove it does not over-catch: `--no-ignore-known` must list only real
   violations.
4. `pnpm arch:baseline` if the rule surfaces legacy debt, and describe the new
   entries in the MR.
5. Update the rules table here and the ⚙ markers in `SKILL.md`.

Syntax notes (dependency-cruiser 17):
- `$1` in `pathNot` refers to the capture group in `from.path`, and must not be
  escaped (`\\$1` matches a literal dollar)
  ([source](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)).
- Type-only exemptions need `tsPreCompilationDeps: true` plus
  `dependencyTypesNot: ['type-only']`.
- `options.enhancedResolveOptions.extensionAlias` is rejected by the v17 schema.
  It is not needed: `.js` → `.ts` resolution works through `tsConfig`.
- npm packages must stay in the graph (`doNotFollow`, not `exclude`/`includeOnly`),
  or the drizzle/fastify rules never fire.
