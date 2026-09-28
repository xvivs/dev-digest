# Constants, helpers, types, styles, naming

What gets extracted, where it goes, and what it is called. Sources in brackets
refer to [sources.md](sources.md).

## Contents
1. What goes where
2. Constants
3. Helpers vs lib
4. Types
5. Styles
6. Env and config
7. Naming
8. File order
9. Good vs bad

## 1. What goes where

| Artifact | Home | Promote when |
|---|---|---|
| Literal used by one component | `<Name>/constants.ts` (or module scope in `<Name>.tsx` if trivial) | a sibling needs it → route `constants.ts` |
| Lookup table, threshold, key map | `constants.ts` with a doc comment saying what it means | same |
| Pure function | `<Name>/helpers.ts` | 2nd component → route `helpers.ts` → 2nd route → `src/lib/<topic>.ts` |
| Wrapper over a third-party or browser API with setup/side effects | `src/lib/` (e.g. `api.ts`, `toast.tsx`) | — |
| Style object | `<Name>/styles.ts` | route `styles.ts` |
| API payload type | `@devdigest/shared` | — |
| View-only type | top of `<Name>.tsx` | helpers/siblings need it → `helpers.ts` |
| Non-reactive object/function used by a component | module scope (outside the component) | — |

Colocate first, promote on the second real consumer [11][24]. The exception is
configuration that is cross-cutting from day one (API base URL, env) — it goes
central immediately.

## 2. Constants

- Name every number or string that carries meaning: `LOW_CONFIDENCE_THRESHOLD = 0.65`,
  not `0.65` inside a filter. Add a one-line doc comment with the meaning.
- `CONST_CASE` only for true module-level constants; a `const` inside a
  function is `lowerCamelCase` [48].
- Module scope gives a stable reference, so it never needs to be an effect
  dependency and never breaks memoisation [52].
- Fixed value sets: prefer an `as const` object or a union type over `enum` —
  erasable, tree-shakable, plain-JS semantics [49][50]. (Google's style guide
  still allows plain `enum` and bans only `const enum` [48]; this repo's
  contracts use Zod enums/unions, so follow those.)
- Type lookup tables against the domain type (`Record<Severity, number>`) or
  with `satisfies` so a missing or misspelt key fails the typecheck while the
  literal type is kept [57].

## 3. Helpers vs lib

| | `helpers.ts` / `src/lib/<topic>.ts` (pure) | `src/lib/*` (infrastructure) |
|---|---|---|
| Contains | pure functions: sort, filter, format, map, count | `apiFetch`, providers, toast, theme, repo context |
| Imports | types, constants, other pure helpers | React, third-party libs, browser APIs |
| Side effects | none | yes |
| Tests | direct unit tests (`helpers.test.ts`) | own tests or via components |

The ecosystem draws the same line — `lib` for preconfigured libraries, `utils`
for pure helpers [1][4] — but no source gives a sharp test. Use this one: *does
it touch the network, the DOM, storage, React or a third-party singleton?* If
yes it is infrastructure (`lib/`), if no it is a helper.

Never create a catch-all `utils.ts`. Grab-bag files grow into unsearchable
"dunghills" [53]. Name files by topic (`github-urls.ts`, `model-label.ts`).

## 4. Types

- Contract types come from `@devdigest/shared`; derive with `z.infer` if you
  need a variant, never re-declare the shape [56].
- Keep view-model types next to the code that builds them.
- Narrow unions instead of `string` for anything with a fixed set of values.
- `import type` for type-only imports.

## 5. Styles

Per ADR 0003 the design system is inline `CSSProperties` over CSS variables.
Feature components follow the same convention in a colocated `styles.ts`:

```ts
import type { CSSProperties } from "react";

export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  card: (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  }),
};
```

- Static styles: object entries with `satisfies CSSProperties`.
- Dynamic styles: typed functions of the few inputs that vary.
- Colours, spacing and radii come from CSS variables (`var(--border)`), not
  hex literals.
- Reach for a `@devdigest/ui` primitive before styling a new button, badge or card.
- Tailwind is installed but not the feature-code convention; don't mix it into
  new `_components`.

## 6. Env and config

`NEXT_PUBLIC_API_BASE` is read once, in `lib/api.ts`. Keep it that way: read
env in exactly one module, never `process.env.X` scattered through components.
If more variables appear, validate them with a Zod schema at load time so a
missing value fails fast with a clear message [54] — and remember Next inlines
only *static* `process.env.NEXT_PUBLIC_X` references in the client bundle, so
pass each variable explicitly instead of `schema.parse(process.env)`.

## 7. Naming

| Thing | Convention | Example |
|---|---|---|
| Component, type, interface | `PascalCase` [48][51] | `FindingsPanel`, `RunSummary` |
| Component folder + file | `PascalCase` under `_components/` | `_components/RunStatus/RunStatus.tsx` |
| Shared leaf folder | `kebab-case` under `src/components/` | `components/run-cost-value/` |
| Functions, variables, props | `camelCase` [48] | `baseFindings`, `hideLow` |
| Module constants | `CONST_CASE` [48] | `SEVERITY_ORDER` |
| Hooks | `useX` — required by the Rules of Hooks lint [62] | `usePrRuns` |
| Data hooks | `use<Resource>` / `use<Verb><Resource>` | `usePrReviews`, `useCancelRun` |
| Event props / handlers | `onX` for props, `handleX` for the local handler (ecosystem convention) | `onDismiss` → `handleDismiss` |
| Booleans | `isX` / `hasX` / `canX` (ecosystem convention) | `isRunning` |
| Style object | `s` from `./styles` | `style={s.body}` |
| Prop holding a component | `PascalCase` [51] | `Icon={CheckIcon}` |

Exports are named everywhere except files Next requires to default-export
(`page`, `layout`, …).

## 8. File order

Inside a `.tsx` file: imports → types → module constants → pure helpers (if
not in `helpers.ts`) → sub-components → the main component → exports. Keep the
component body for hooks, derived values, handlers and JSX.

## 9. Good vs bad

```tsx
// ❌ magic number and inline style inside JSX
{findings.filter((f) => f.confidence >= 0.65).map((f) => (
  <div style={{ padding: 12, color: "#888" }}>{f.title}</div>
))}

// ✅ named constant, pure helper, styles.ts
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";
import { s } from "./styles";
{visible.map((f) => <div key={f.id} style={s.row}>{f.title}</div>)}
```

```ts
// ❌ enum
enum Tab { Overview, Findings, Diff }

// ✅ as const + derived union
export const TABS = ["overview", "findings", "diff"] as const;
export type Tab = (typeof TABS)[number];
```

```ts
// ❌ untyped lookup — misspelt key compiles
export const SEVERITY_LABEL = { CRITICAL: "Critical", WARNNG: "Warning" };

// ✅ keys checked against the domain type
// (Severity = z.enum(["CRITICAL", "WARNING", "SUGGESTION"]) in @devdigest/shared)
export const SEVERITY_LABEL = { CRITICAL: "Critical", WARNING: "Warning", SUGGESTION: "Suggestion" }
  satisfies Record<Severity, string>;
// (user-facing labels themselves belong in next-intl messages; this shows the typing technique)
```

```
// ❌ catch-all
src/lib/utils.ts          // formatCost, githubPrUrl, clamp, modelLabel, …

// ✅ by topic
src/lib/github-urls.ts
src/lib/model-label.ts
src/components/run-cost-value/helpers.ts   // formatCost lives with its component
```

```ts
// ❌ object recreated each render and used as an effect dependency
function Chart() {
  const margin = { top: 8, right: 8 };
  useEffect(() => draw(margin), [margin]);   // runs every render
}

// ✅ module scope
const MARGIN = { top: 8, right: 8 } as const;
function Chart() { useEffect(() => draw(MARGIN), []); }
```

```ts
// ❌ CONST_CASE on a local
function total(items: Item[]) { const MAX_ITEMS = 100; /* … */ }

// ✅
const MAX_ITEMS = 100;
```

```ts
// ❌ env read in a component
const url = `${process.env.NEXT_PUBLIC_API_BASE}/agents`;

// ✅ go through the one module that owns it
const agents = await api.get<Agent[]>("/agents");
```
