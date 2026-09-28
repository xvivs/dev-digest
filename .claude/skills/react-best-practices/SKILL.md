---
name: react-best-practices
description: "React 19 best practices and anti-pattern catalog for the DevDigest client. Use when writing, reviewing, or refactoring React components and hooks — state, derived values, effects, memoization and React Compiler, keys, conditional rendering, error boundaries, forms and Actions, accessibility."
---

# React Best Practices & Anti-Patterns

React 19 conventions for `client/` (Next 15 App Router, TanStack Query). Covers
how components and hooks behave. Code examples: [examples.md](examples.md).

**Not here:** where files live, how to split components, which layer owns
which logic, constants/naming → `frontend-architecture`. Server/Client
Component boundaries → `next-best-practices`. Re-render and bundle
performance catalog → `vercel:react-best-practices` (ignore its SWR and
Tailwind/shadcn advice here — data is TanStack Query, styling is `styles.ts`
per ADR 0003).

## Severity Levels

- **CRITICAL** — Will cause bugs, broken reconciliation, or maintenance nightmares
- **HIGH** — Will cause performance issues or scaling problems
- **MEDIUM** — Will hurt maintainability or developer experience

---

## Component Purity (CRITICAL)

- Components and hooks must be pure — same inputs, same output; no side effects,
  no mutation of props/state/outer variables during render [Rules of React]
- Side effects belong in event handlers, or in effects when synchronising with
  an external system
- Helper functions go OUTSIDE the component body (and into `helpers.ts` when
  they carry business rules — see `frontend-architecture`)
- Never define a component inside another component — it becomes a new type
  every render and resets all state below it
- Separate logic from rendering with a custom hook, not with a mandatory
  container/presenter split (its author retracted that pattern once hooks existed)

### Composition Patterns

- Compose small focused components over monolithic ones
- "Lift Content Up" — pass children from the parent when the wrapper doesn't use them for logic
- "Push State Down" — keep state in the component that actually needs it
- Try both before reaching for `memo` (Dan Abramov, "Before You memo()")
- Prefer `children` and composition over deep prop drilling

## Derive, Don't Store (CRITICAL)

The #1 React anti-pattern. Look for it in every review.

- NEVER store derived values in `useState` — compute during render
- NEVER use `useState` + `useEffect` to sync a computed value — just compute it
- NEVER copy TanStack Query `data` into `useState` — read and derive from `data`
  (a form *draft* seeded from server data is legitimate client state)
- Memoize only when it is measurably expensive: react.dev's bar is "creating or
  looping over thousands of objects", or ≥1ms in `console.time`
- Clamp or correct values on read rather than keeping a corrected copy in state

## State Management (HIGH)

### State Location
- Colocate state with the components that use it
- Don't lift state higher than necessary — it causes unnecessary re-renders
- Don't duplicate state across components; store an id, derive the object

### State Shape
- Only values that change over time and affect the UI belong in state
- One `status` union beats several booleans that can contradict each other
- Combine related state with `useReducer` instead of multiple `useState` calls
- Linkable/reload-surviving state (tab, filters, pagination) goes in URL search
  params via `useSearchParams` / `useRouter` from `next/navigation`

### Context API
- Context is for dependency injection (theme, toast, repo context), NOT for
  frequently changing global state
- Context changes re-render ALL consumers — split contexts by concern
- Subscribing to a non-React store (browser API, external library)? Use
  `useSyncExternalStore`, not an effect + `setState` (avoids tearing)

### Resetting State
- To reset a subtree when an id changes, give it `key={id}` — not an effect that
  clears state. This is intentional and must not be flagged as an unstable key

## Hooks (HIGH)

### useEffect Rules
Before each `useEffect`, ask: **Is there an external system being synchronized?**
react.dev: use effects only for code that should run *because the component was
displayed*. If no, it's misused.

- NEVER use `useEffect` for derived state — compute during render
- NEVER use `useEffect` for event handling or mutations — put logic in the handler
- NEVER chain `useEffect`s that trigger each other — usually means derived state
- NEVER fetch in `useEffect` — use a TanStack Query hook from `lib/hooks/*`
- ALWAYS declare all dependencies correctly
- ALWAYS clean up subscriptions, timers, and event listeners
- Don't write lifecycle wrappers (`useMount`, `useUpdateEffect`) — name hooks
  after what they synchronise (`useChatRoom`)

### Memoization Rules
Most `useMemo`/`useCallback` calls are unnecessary. Each has exactly these
legitimate cases (react.dev):

- `useMemo` — (1) measurably expensive calculation; (2) value passed to a
  `memo`-wrapped child; (3) value used as a dependency of another hook
- `useCallback` — (1) function passed to a `memo`-wrapped child; (2) function
  used as a dependency of another hook; (3) functions returned from a custom hook
  ("so consumers can optimize their own code")
- `memo` is useless when props are always new (inline objects/functions)
- Simple string concatenation, arithmetic, or boolean checks never need memoization

### React Compiler
`client/` does not enable the compiler today (no `babel-plugin-react-compiler`),
so the Memoization Rules above apply as written. If it gets enabled:
- New code: rely on the compiler; use `useMemo`/`useCallback` only as an escape
  hatch for precise control
- Existing code: **leave existing memoization in place** — "removing it can change
  compilation output" — or remove it only with careful testing (React Compiler 1.0)

## Render Factories (CRITICAL)

camelCase functions returning JSX are NOT React components. They break
reconciliation, hooks, and dev tools.

- NEVER use the `renderThing()` pattern — use `<Thing />` component syntax
- NEVER call a component function directly — use it in JSX
- ALWAYS use PascalCase for anything that returns JSX

## Inline Creation in JSX (HIGH)

New arrays, objects, and functions created inline in JSX props break `memo` on
children and re-trigger effects that depend on them.

- Extract static arrays/objects to module-level constants
- Dynamic arrays/objects → `useMemo` only in the cases listed under Memoization
- Inline functions → `useCallback` only in the cases listed under Memoization

## Over-Engineering (CRITICAL)

- Abstractions with only one consumer are premature — inline them ("prefer
  duplication over the wrong abstraction")
- "Reusable" hooks with hardcoded field names are not reusable — accept config as parameters
- Context storing state that could be computed locally is over-engineered
- Components that only call a hook and return `null` are unnecessary — call the hook directly
- Wrappers that only pass props through add indirection without value

## Data Fetching (HIGH)

- ALL client data fetching goes through TanStack Query hooks in `src/lib/hooks/<domain>.ts`
  over `src/lib/api.ts` — never `fetch`/`apiFetch` from a component
- Handle loading, error, and empty states explicitly (early returns)
- Branch the error surface on `ApiError.status` (status `0` = API unreachable)
- Cancellation comes from the query: `queryFn` receives `{ signal }` — forward it
  via `apiFetch(path, { signal })` (the `api.get` shorthand takes no init); no
  hand-rolled `AbortController` effects
- Polling via `refetchInterval`, not `setInterval`
- Mutations are triggered from event handlers; toast/navigate in `onSuccess` or
  after `mutateAsync`
- Server Components fetching directly: see `next-best-practices`

## Forms & Actions (React 19) (MEDIUM)

- `useActionState` gives a form action pending/error/result state without
  hand-rolled `isSubmitting` booleans
- `useOptimistic` shows the expected result while a mutation is in flight
- `useFormStatus` reads the parent form's pending state from a child button
- In this app mutations go to the Fastify API through TanStack Query; use
  Actions/`useActionState` when they simplify form state, not as a second data layer

## Concurrency (MEDIUM)

- `useTransition` — mark a non-urgent update (tab switch, heavy filter) so input stays responsive
- `useDeferredValue` — render a lagging copy of a fast-changing value (search input → results)
- `use(promise | context)` — read a promise or context in render; integrates with
  Suspense and error boundaries; the only hook callable conditionally
- Place `<Suspense>` boundaries around independent regions, not one boundary for
  the whole screen

## Error Boundaries (HIGH)

- Route-level first: Next `error.tsx` files are error boundaries per segment
  (see `next-best-practices`). `client/` has none yet and does not depend on
  `react-error-boundary` — adding the package is a dependency decision, not a drive-by
- For a component-level boundary with `react-error-boundary`: reset on navigation
  with `resetKeys={[pathname]}` (`usePathname()` from `next/navigation`) and give
  the fallback a "Try again" button that calls `resetErrorBoundary`
- Boundaries do NOT catch errors in event handlers, async code after render, or
  SSR — use try/catch there. Exception (React 19): errors thrown inside
  `startTransition` Actions ARE caught by the nearest boundary

## Key Prop Patterns (CRITICAL)

- NEVER use array index as `key` when lists can be reordered, filtered, or modified
  (a static list that never changes may use the index)
- NEVER use `Math.random()` or other unstable values as keys — causes full unmount/remount
- When mapping Fragments, put `key` on `<Fragment key={id}>`, not on a child
- Changing `key` on purpose to reset state is correct (see Resetting State)

## Conditional Rendering (HIGH)

- NEVER use `{count && <Component />}` when `count` can be `0` — renders literal `0`
- Use `{count > 0 && <Component />}` or a ternary instead
- Replace nested ternaries with early returns or extracted components
- For multiple UI states (loading/error/empty/success), use early returns

## Styling (MEDIUM)

- Follow ADR 0003: colocated `styles.ts` with `CSSProperties` over CSS variables;
  no inline `style={{…}}` literals in JSX, no Tailwind in new feature code
- Reuse `@devdigest/ui` primitives before building a new button/badge/card
- Details: `frontend-architecture` → constants-utils-naming reference

## Accessibility (HIGH)

- Add `aria-label` to icon-only buttons — without it, they're invisible to screen readers
- Link error messages to fields with `aria-describedby` and `aria-invalid`
- Use `aria-live="polite"` for dynamic content updates (search results, toasts, run status)
- Modals (WAI-ARIA APG): `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
  (or `aria-label`), focus moved in and trapped, Escape and a visible Close button
- Announce route changes for screen readers (SPA navigation is silent by default)

## Code Splitting (MEDIUM)

- Lazy-load heavy client-only components with `next/dynamic` (Next's composite
  of `React.lazy` + Suspense); `{ ssr: false }` only when it truly needs the browser
- Use static import paths in `dynamic(() => import('./X'))` — dynamic paths break
  build analysis
- Bundle-level tuning (barrels, `optimizePackageImports`): see `frontend-architecture`
  and `vercel:react-best-practices`

## React 19 API Changes (MEDIUM)

- Accept `ref` as a regular prop instead of `forwardRef` (forwardRef still works;
  deprecation is announced for a future version)
- `<Context>` can be rendered as a provider directly (`<ThemeContext value={…}>`)

## Sources

react.dev: Rules of React, You Might Not Need an Effect, useMemo, useCallback,
memo, Preserving and Resetting State, Rendering Lists, useActionState,
useOptimistic, use, useTransition, useSyncExternalStore, React v19 blog, React
Compiler v1.0 blog (2025-10-07). Dan Abramov — "Before You memo()",
"Presentational and Container Components" (2019 note). react-error-boundary
README. WAI-ARIA APG Dialog pattern. Next.js lazy-loading guide. Full URLs and
the fact-check behind each change: `docs/research/react-best-practices-research.md`.
