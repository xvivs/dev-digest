# INSIGHTS — client

Append-only journal of things that cost us time in `@devdigest/web`. Write here
**first** and without a filter: an entry is cheap, a line in `CLAUDE.md` is not.

Findings that cross package boundaries go in the repo-root `../INSIGHTS.md`.

Priority: anything that surprised you, broke in a non-obvious way, or where the
obvious fix turned out to be wrong.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

- A cross-route presentational component (used on 3+ screens with different
  typography contexts) stays a bare `<span style={style}>` with **no own**
  `fontSize`/`color`/`padding` — it inherits the caller's typography instead of
  imposing its own. `RunCostValue` (`src/components/run-cost-value/`) is the
  precedent: identical component renders correctly in an 11px timeline row
  (`RunHistory.tsx`), a 16px sidebar `Stat` card (`TraceBody.tsx`), and a table
  cell (`PRRow.tsx`), with the call site owning all layout/typography via an
  optional `style?: CSSProperties` passthrough (mirrors `Badge.tsx`).

## What Doesn't Work

## Codebase Patterns

- Dynamic i18n key lookup — `t(\`namespace.${variable}\`)` — is an established,
  working pattern in this codebase, not a hack. Precedent:
  `t(\`runStatus.${o.key}\`)` in `RunHistory.tsx`. Used again in
  `RunCostValue.tsx` for `t(\`missing.${reason}\`)` to map a `cost_missing_reason`
  enum value straight to its tooltip copy without a switch statement.
- A new cross-route namespace (rendered from components used on multiple
  screens, e.g. inside both `prReview` and `runs` namespaced trees) can't
  borrow either screen's namespace — it needs its own
  `messages/en/<namespace>.json` file. `cost.json` was added for this reason:
  `RunCostValue` renders inside `RunHistory` (namespace `prReview`), `TraceBody`
  (namespace `runs`), and `PRRow` (namespace `prReview`), so a shared
  `cost` namespace was the only option that didn't create a false coupling
  between `prReview` and `runs`.

## Tool & Library Notes

- In this worktree, `pnpm typecheck` / `pnpm test` / any `pnpm exec …` first
  runs pnpm's dependency-status preflight, which itself calls `pnpm install`
  and fails here with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts:
  esbuild@0.21.5, sharp@0.34.5` (needs `pnpm approve-builds`, not run in this
  session). `node_modules` is otherwise complete and correct. Workaround:
  invoke the binaries directly, bypassing pnpm's wrapper —
  `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vitest run`.
  Both produced clean results once called this way.

## Recurring Errors & Fixes

- Every RTL test that renders a component tree containing a cross-route leaf
  (`RunHistory`, `TraceBody` inside `RunTraceDrawer`, `PRRow`) must merge in
  that leaf's own i18n namespace on top of the screen's namespace, e.g.
  `messages={{ prReview: messages, cost: costMessages }}` — a single-namespace
  `NextIntlClientProvider` throws on the first missing message the moment the
  leaf renders. `RunHistory.test.tsx` and `RunTraceDrawer.test.tsx` both needed
  this update after `RunCostValue` (namespace `cost`) was added to their trees.

## Session Notes

- Cost Badge (L01, client half): added `RunCostValue` + `formatCost`/`exactCost`
  (`src/components/run-cost-value/`) and wired it into the PR timeline
  (`RunHistory.tsx`, with a new `formatTokenTotal` in its own `helpers.ts`), the
  run trace sidebar (`TraceBody.tsx`, 4th `Stat` card), and the PR list table
  (new `cost` column between STATUS and UPDATED — `constants.ts`, `styles.ts`,
  `page.tsx`, `PRRow.tsx`). The server/reviewer-core/contracts half of this
  feature was built in parallel by another agent in the same worktree; by the
  time this work finished, `contracts/cost.ts` and the `cost_usd` /
  `cost_source` / `cost_missing_reason` fields on `RunSummary`, `RunStats`, and
  `PrMeta` were already present in both vendored `shared` copies, so
  `pnpm typecheck` and `pnpm test` were both clean end to end — no landing gap
  to work around this time.

## Open Questions
