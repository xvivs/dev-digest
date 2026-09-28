---
name: frontend-architecture
description: "Frontend architecture for the DevDigest client (Next 15 App Router + TanStack Query). Use when deciding where a new component, hook, constant, helper, type or style goes; when splitting or restructuring a component; when placing business logic vs data access vs UI state; when reviewing a client PR for structure, layering or naming; or when adding a new route or feature screen under client/src."
---

# Frontend Architecture (DevDigest client)

Where code lives in `client/src`, how it is split, and which layer owns which
logic. Hooks/state/effects rules live in `react-best-practices`; Server/Client
boundaries and Next file conventions in `next-best-practices`; re-render and
bundle performance in `vercel:react-best-practices`. This skill does not repeat them.

Source of truth for the local conventions: `client/AGENTS.md` and
`client/docs/component-anatomy.md`. If they and this skill ever disagree, they
win — flag the drift instead of picking silently.

## The layer map

```
src/app/**/page.tsx          route — thin: resolve params, compose, nothing else
  └─ _components/<Name>/     feature view + its constants / helpers / styles
       └─ src/lib/hooks/*    server state (TanStack Query), grouped by domain
            └─ src/lib/api.ts the only place that calls fetch (apiFetch → ApiError)
```

**Nothing skips a layer.** A component never calls `apiFetch`; a hook never
renders; `helpers.ts` never imports React. That one rule is what makes every
other placement decision below mechanical.

| Layer | Holds | Lives in | Must not import |
|---|---|---|---|
| Route | params → props, composition | `app/**/page.tsx` | business rules, `apiFetch` |
| View | JSX, UI state (`useState`), event handlers | `_components/<Name>/<Name>.tsx` | `apiFetch`, raw `fetch` |
| Domain | pure calculations, filters, sorts, policies | `helpers.ts` (component or route level) | React, hooks, `api.ts` |
| Server state | `useQuery` / `useMutation`, keys, invalidation | `lib/hooks/<domain>.ts` | components, JSX |
| Core | `apiFetch`, providers, toast, theme, repo context | `lib/*.ts(x)` | feature components |
| Contracts | shared Zod schemas + types | `@devdigest/shared` (vendored, frozen) | — |
| Design system | primitives, kit, shell | `@devdigest/ui` (`src/vendor/ui`, editable) | feature code |

## Where does X go? (decision rules)

Apply the **promotion rule**: code starts next to its only consumer and moves
up one tier only when a *second real consumer* appears — never in anticipation.

| Artifact | First home | Promote to | When |
|---|---|---|---|
| Component | `_components/<Name>/` next to the route | `src/components/<name>/` | used by a 2nd route screen |
| | `src/components/<name>/` | `@devdigest/ui` | a generic primitive used by >1 feature (render it in `Showcase.tsx`) |
| Sub-part of a big feature | nested `<Name>/_components/<Part>/` | sibling `_components/` | another feature on the same route needs it |
| Literal / lookup table / threshold | `<Name>/constants.ts` | route-level `constants.ts` | shared by siblings under one route |
| Pure function | `<Name>/helpers.ts` | route-level `helpers.ts` → `src/lib/<topic>.ts` | 2nd component / 2nd route |
| Styles | `<Name>/styles.ts` (`CSSProperties` over CSS vars — ADR 0003) | route-level `styles.ts` | shared by siblings |
| Data hook | `lib/hooks/<domain>.ts` | — (always here) | — |
| Type of an API payload | `@devdigest/shared` (`z.infer`) | — | change server + client copies together |
| Local view type | top of `<Name>.tsx` | `helpers.ts` / domain file | reused by helpers or siblings |
| User-facing string | `messages/<locale>/<namespace>.json` via `next-intl` | own namespace | component is used across route namespaces |

Details, examples and the reasoning behind each row: [references/structure.md](references/structure.md)
and [references/constants-utils-naming.md](references/constants-utils-naming.md).

## Rules by severity

Severity is for reviewers: **CRITICAL** breaks the layering or produces bugs,
**HIGH** creates coupling that will cost a refactor, **MEDIUM** hurts
readability or consistency.

### CRITICAL
- A component calls `apiFetch`/`fetch`, or a hook returns JSX — layer skipped.
- Server data copied into `useState` and re-synced in an effect — it goes stale
  and bypasses cache/invalidation. Read it from the query. (A *draft* seeded
  from server data is client state and is fine.)
- A component defined inside another component's body — new type per render,
  state below it resets.
- A feature imports another feature's internals (`../OtherFeature/helpers`)
  instead of its `index.ts`, or a route reaches into another route's
  `_components/`. Promote the shared piece instead.
- Edits under `src/vendor/shared/**` without the matching `server/` change.

### HIGH
- Business rule (filter, sort, threshold, status mapping) written inline in JSX
  instead of a pure function in `helpers.ts` — untestable without rendering.
- Mutation or notification fired from `useEffect` instead of the event handler
  that caused it.
- A new query key that does not match the existing tuple for the same resource
  (e.g. `["review", id]` next to `["reviews", id]`) — invalidation misses it.
- Code pulled into a shared tier with a single consumer (premature abstraction),
  or a catch-all `utils.ts` growing unrelated helpers.
- A component growing boolean props to special-case callers — use a `variant`
  union, `children`/slots, or split the component.

### MEDIUM
- Missing `index.ts`, or consumers importing `<Name>/<Name>.tsx` directly.
- Magic numbers or string literals in JSX instead of named `constants.ts` entries.
- Inline `style={{…}}` in JSX instead of `styles.ts`; Tailwind classes in new
  feature code (the convention is `styles.ts`, ADR 0003).
- Inlined copy instead of `next-intl`.
- Naming off-convention (see naming table in the constants reference).

## Splitting a component

Split on **symptoms, never on line or prop counts** — no primary source backs
numeric limits. Split when you *experience* one of:

- it does more than one job (several unrelated state groups or handlers);
- mutually exclusive UI states (loading / empty / error / data) tangle into
  `?:` / `&&` chains → early-return branches around a shared layout;
- a fast-changing piece of state re-renders unrelated siblings → move the state
  down into the part that needs it, or lift content up via `children`;
- props keep sprouting booleans or content props (`titleIcon`, `bodyText`) →
  `variant` union, `children`, compound components;
- logic you want to unit-test is trapped in the render → move it to `helpers.ts`;
- a `page.tsx` starts holding state or branching on data shape → move it into
  `_components/<Name>/`.

Container/Presentational as a mandatory split is legacy; a custom hook
separates logic from rendering without an extra component.
Patterns, anti-patterns and examples: [references/components.md](references/components.md).

## Logic layers in one paragraph

Pure domain logic goes in `helpers.ts` and is tested directly. Data access goes
through a hook in `lib/hooks/<domain>.ts` over `api.ts`; the component consumes
the hook. UI-only state (open, hovered, active tab, form draft) stays in the
component, or in the URL (`?tab=`, `?severity=`) when it must survive reload or
be linkable. Cross-cutting infrastructure (toast, theme, repo context, query
client) lives in `lib/` as providers. Full model, server-vs-client-state table
and examples: [references/logic-layers.md](references/logic-layers.md).

## Before changing an established pattern

Some improvements from the wider ecosystem are deliberately **not** applied here
yet — query-key factories + `queryOptions`, lint-enforced import boundaries,
server-side data fetching in RSC, Tailwind. Proposing one is an architectural
decision: raise it as an ADR in `docs/adr/` rather than introducing it in a
feature PR. New code follows the existing pattern until then.

## Completion check

Before calling a client change done, every new or moved file answers yes:

1. It sits in the lowest tier that has all its consumers (promotion rule).
2. It imports only from its own layer or below (layer map).
3. Its folder exposes an `index.ts`, and nothing outside imports past it.
4. Every literal, pure function and style object is in `constants.ts` /
   `helpers.ts` / `styles.ts` when the component has behaviour worth testing.
5. `cd client && pnpm typecheck && pnpm test` pass.

## References

- [references/structure.md](references/structure.md) — folders, anatomy, promotion, barrels, import direction.
- [references/components.md](references/components.md) — decomposition signals, composition patterns, legacy advice.
- [references/logic-layers.md](references/logic-layers.md) — domain / server state / UI state, DTO boundary.
- [references/constants-utils-naming.md](references/constants-utils-naming.md) — constants, helpers vs lib, types, naming.
- [references/sources.md](references/sources.md) — primary sources behind every rule.
