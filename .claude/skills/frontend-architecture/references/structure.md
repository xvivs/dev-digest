# Project structure

Where files live in `client/src`, and why. Sources in brackets refer to
[sources.md](sources.md).

## Contents
1. The tree
2. Component folder anatomy
3. The promotion ladder
4. Import direction
5. Barrels (`index.ts`)
6. Next App Router specifics
7. Good vs bad

## 1. The tree

```
client/src/
  app/                          routes (App Router)
    repos/[repoId]/pulls/
      page.tsx                  thin route
      constants.ts helpers.ts styles.ts   shared by this route's components
      _components/<Name>/       feature components (private folder, not routable)
      [number]/page.tsx
        _components/RunTraceDrawer/
          _components/ToolCallRow/        nested parts of one big feature
  components/<name>/            leaf reused by 1–2 route screens
  components/app-shell/         cross-cutting chrome (nav, breadcrumbs, shortcuts)
  lib/api.ts                    single fetch chokepoint
  lib/hooks/<domain>.ts         TanStack Query hooks: core, agents, reviews, trace, repo-intel
  lib/*.ts(x)                   providers, toast, theme, repo context, small cross-route helpers
  vendor/ui/                    @devdigest/ui design system — editable (ADR 0003)
  vendor/shared/                @devdigest/shared contracts — mirrored in server/, change both
  i18n/  test/
client/messages/<locale>/<namespace>.json
```

**Why colocate by route instead of a top-level `features/`:** Next makes any
non-`page`/`route` file inside `app/` safe to colocate, and `_folder` opts a
folder out of routing entirely [7]. Colocation keeps everything that changes
together in one place, so missing tests are visible and nothing drifts between
a file and its style/test twin [11]. The wider ecosystem's
`features/`-outside-`app/` layout is a community convention, not a Next
recommendation [7][12] — this repo chose route colocation (`client/AGENTS.md`).

## 2. Component folder anatomy

```
_components/<Name>/
  <Name>.tsx        the component
  index.ts          the only import path others use
  <Name>.test.tsx   where there is behaviour to assert
  constants.ts      literals, lookup tables, thresholds
  helpers.ts        pure functions, tested directly
  styles.ts         CSSProperties objects over CSS vars
  _components/      optional: private parts of this feature
```

Take only the files you need — a presentational component is often
`<Name>.tsx` + `index.ts`. Add `constants.ts` / `helpers.ts` / `styles.ts` as
soon as the component has more than a couple of each; a 3-line helper used once
can stay at module scope in `<Name>.tsx` (outside the component body).

Real example: `app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/`
has all six files; `helpers.ts` exports `baseFindings` / `bySeverity`, which
read `SEVERITY_ORDER` and `LOW_CONFIDENCE_THRESHOLD` from `constants.ts`.

## 3. The promotion ladder

```
<Name>/ (component)  →  route-level file  →  src/components/<name>/ or src/lib/  →  @devdigest/ui
```

Move one rung up only when a **second real consumer** exists [11][13].
Promoting on the first use is a guess about future reuse; "duplication is far
cheaper than the wrong abstraction" [24].

| From | To | Trigger |
|---|---|---|
| component `helpers.ts` | route `helpers.ts` | a sibling component under the same route needs it |
| route `helpers.ts` | `src/lib/<topic>.ts` (e.g. `github-urls.ts`, `model-label.ts`) | a second route needs it |
| `_components/<Name>/` | `src/components/<name>/` | a second route screen renders it |
| `src/components/<name>/` | `@devdigest/ui` | it is a generic primitive used by more than one feature; also render it in `src/components/showcase/Showcase.tsx`, which the smoke test mounts |

Going *down* is fine too: if a shared thing ends up with one consumer, move it
back next to that consumer.

## 4. Import direction

Imports point one way — toward more generic code:

```
page.tsx → _components → src/components → lib/hooks → lib/api.ts
                      ↘ @devdigest/ui     ↘ @devdigest/shared
```

- A lower tier never imports a higher one (`lib/` never imports from `app/`;
  `@devdigest/ui` never imports feature code).
- Siblings do not import each other's internals. Compose them in the parent,
  or promote the shared piece [1][3].
- Use the aliases `@devdigest/ui`, `@devdigest/shared`, `@/…`, not relative
  paths into `vendor/`.

Enforcement is currently by review, not lint. Tools that could enforce it
(`eslint-plugin-boundaries`, `import/no-restricted-paths`) [1][15] are an ADR
decision, not a feature-PR change. Without enforcement the rule erodes within
a few PRs once several people contribute [6] — so reviewers should treat a
violation as CRITICAL.

## 5. Barrels (`index.ts`)

The rule that reconciles both camps [5][13][14]:
**shallow + explicit + at a real boundary = fine; deep + wildcard + everywhere = anti-pattern.**

- A component folder's `index.ts` re-exports that one component — shallow and
  explicit. Keep it; it is the folder's public API, so internals can move freely.
- Deep wildcard barrels force the bundler to load the whole graph: TkDodo
  measured 11k → 3.5k modules (−68%) and 5–10 s dev start-ups after removing
  them in a Next project [14]; they also defeat `optimizePackageImports` [8]
  and invite circular imports.
- `lib/hooks/index.ts` is an existing `export *` over five domain files. It is
  tolerated because it is one level deep; do not add new `export *` barrels,
  and prefer importing from the domain file (`@/lib/hooks/reviews`) in new code.

## 6. Next App Router specifics

- `_components/`, `constants.ts` etc. inside `app/` are never served; only
  `page`, `route`, `layout` and other special files are [7].
- Route groups `(group)` organise without changing the URL [7].
- In this app data comes from the Fastify API through client-side TanStack Query
  hooks, so most interactive pages are `"use client"` and thin route entries
  like `app/agents/page.tsx` just render one view component. When a route *can*
  stay a Server Component, keep `"use client"` on the leaves that need
  interactivity [36]. RSC rules themselves: `next-best-practices`.
- Pages are default exports (Next requires it); everything else uses named
  exports.

## 7. Good vs bad

```ts
// ❌ reaching past a sibling's public API
import { baseFindings } from "../FindingsPanel/helpers";

// ✅ promote the shared function one rung (route-level helpers.ts)
import { baseFindings } from "../../helpers";
```

```ts
// ❌ route A imports from route B's private folder
// app/agents/[id]/_components/Editor/Editor.tsx
import { RunCost } from "@/app/repos/[repoId]/pulls/_components/RunCost";

// ✅ second route screen → promote to src/components
import { RunCostValue } from "@/components/run-cost-value";
```

```
// ❌ helper promoted on day one, one consumer
src/lib/format-review-score.ts        ← imported only by ReviewCard.tsx

// ✅ stays next to its consumer until a second one appears
_components/ReviewCard/helpers.ts
```

```
// ❌ parallel test tree
client/src/__tests__/FindingsPanel.test.tsx

// ✅ colocated
_components/FindingsPanel/FindingsPanel.test.tsx
```

```ts
// ❌ new deep wildcard barrel
// src/components/index.ts
export * from "./severity-icons";
export * from "./diff-viewer";
export * from "./findings-popover";

// ✅ import the folder you need
import { SeverityIcons } from "@/components/severity-icons";
```

```tsx
// ❌ page holds state and branches on data shape
export default function PullsPage() {
  const [filter, setFilter] = useState("");
  const { data } = usePulls(repoId);
  const rows = data?.filter(/* 20 lines of rules */);
  return /* 150 lines of JSX */;
}

// ✅ thin route, feature logic in _components
export default function PullsPage() {
  return <PullsView />;
}
```
