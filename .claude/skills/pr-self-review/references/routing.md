# Routing: file → lens → skills

The executable source of truth is `routeFile()` in `../scripts/lib.mjs`. This
page explains it; if the two disagree, the code wins and this page is stale.

Only **committed** changes of the branch are routed (`git diff <merge-base origin/main>...HEAD`).
Content-based rules read the file at `HEAD`.

| Match | Lens | Skills | Blocking |
|---|---|---|---|
| `client/src/**/*.{ts,tsx}` (not tests) | `client-arch` | `frontend-architecture`, `react-best-practices`, `next-best-practices` (+ `zod` if the file imports it) | yes |
| `client/**/*.test.{ts,tsx}`, `client/src/test/**` | `client-tests` | `react-testing-library` | yes |
| `server/src/{modules,platform,adapters}/**` | `server-arch` | `onion-architecture` | yes |
| `server/src/**` importing `fastify`, or `routes.ts` / `routes/`, `app.ts`, `server.ts` | `server-tech` | `fastify-best-practices` | yes |
| `server/src/**` importing `drizzle-orm`, `server/src/db/**`, `*repository*` | `server-tech` | `drizzle-orm-patterns` | yes |
| `server/src/db/schema/**` | `server-tech` | `postgresql-table-design` | yes |
| `server/src/**` importing `zod` | `server-tech` | `zod` | yes |
| `reviewer-core/src/**` (not tests) | `core-purity` | checklist in `lens-prompts.md` (+ `zod`) | yes |
| module routes, `adapters/{auth,secrets,github,git,llm}`, `app.ts`, `server.ts`, `platform/config.ts`, `client/src/lib/api.ts`, `reviewer-core/src/prompt.ts`, or any file containing `dangerouslySetInnerHTML`, `innerHTML`, `react-markdown`, `child_process`, `execFile`, `spawn(`, `eval(`, `new Function(` | `security` | `security` | yes |
| every routed `.ts`/`.tsx` file, only with `--full` | `ts-advisory` | `typescript-expert` | no (capped at HIGH) |
| `client/src/**/*.tsx`, only with `--full` | `react-perf` | `vercel:react-best-practices` | no (capped at HIGH) |

**Never routed to a lens** (deterministic checks still see them): deleted
files, `*.md`, `pnpm-lock.yaml`, `server/src/db/migrations/**`,
`*/src/vendor/shared/**`, binaries, non-TypeScript files, `server/test/**`,
`e2e/**` (e2e gets `pnpm typecheck` only).

Not used on purpose: `mermaid-diagram`, `engineering-insights` (not review
skills), the built-in `/code-review` and `/security-review` (overlap with the
lenses and bring a second, inconsistent severity scale).

## Severity normalization (`capSeverity()` in `lib.mjs`)

| Skill | Own scale | Shared scale |
|---|---|---|
| `onion-architecture`, `frontend-architecture`, `react-best-practices`, `core-purity` | CRITICAL/HIGH/MEDIUM for findings | 1:1 |
| `security` | severity + confidence | CRITICAL only with `confidence: HIGH`, else HIGH |
| `zod` | CRITICAL = rule-category priority, not finding severity | HIGH, except `parse-*` with `confidence: HIGH` |
| everything else | none | HIGH at most |
| advisory lenses | — | HIGH at most, never blocking |

A lens CRITICAL blocks only after the `opus` skeptic confirms it. A refuted one
becomes HIGH and is logged to `.devdigest/self-review/refuted.jsonl`.

## Deterministic checks (`check`)

Packages come from changed paths, plus two cross-package edges: a
`reviewer-core/**` change also type-checks `server` (it aliases the raw
source), and a `server/src/vendor/shared/**` change also type-checks
`reviewer-core` (it aliases the server copy).

| Check | Severity on failure |
|---|---|
| `pnpm typecheck` per package | CRITICAL |
| `pnpm exec vitest run --exclude '**/*.it.test.ts'` (client, server, reviewer-core) | CRITICAL |
| `pnpm arch:check` when `server/**` changed | CRITICAL |
| missing `node_modules` in a package to check | CRITICAL |
| a `*/src/vendor/shared/<path>` changed without its twin in the other package | CRITICAL |
| an existing `server/src/db/migrations/*.sql` modified, or a new one without a `db/schema/**` change | CRITICAL |
| `server/.dependency-cruiser-known-violations.json` grew | CRITICAL |
| the same baseline file created in this branch and not equal to a fresh `depcruise-baseline` run (same `from → to [rule]` set) | HIGH |
| a secret pattern in an added line | CRITICAL |
