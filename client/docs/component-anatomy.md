# Component anatomy

How a route, a feature component and a data hook fit together in
`@devdigest/web`. Follow this and a new screen looks like every other screen.

## The three layers

```
src/app/**/page.tsx           route — thin, composes, holds no feature logic
  └─ _components/<Name>/      feature logic, colocated with the route that uses it
       └─ src/lib/hooks/*     data access (TanStack Query)
            └─ src/lib/api.ts single fetch chokepoint
```

Nothing skips a layer. A component never calls `apiFetch`; a hook never renders.

## Pages are thin

A `page.tsx` resolves route params, composes feature components and nothing else.
When a page starts holding state or branching on data shape, that logic moves
into a `_components/<Name>/`.

Feature folders are **colocated with their route**, not centralised — a component
used by one screen lives next to that screen. Genuinely cross-route chrome (nav,
breadcrumbs, `g`-then-key shortcuts) lives in `src/components/app-shell`.

## A feature component folder

```
_components/<Name>/
  <Name>.tsx        the component
  index.ts          barrel — the only import path others use
  <Name>.test.tsx   colocated test, where there is behaviour to assert
  constants.ts      literals
  helpers.ts        pure functions, independently testable
  styles.ts         colocated styles
```

Take only the files you need — a presentational component is often just
`<Name>.tsx` + `index.ts`. Import through the barrel, never reach past it into a
sibling's internals.

Nesting is allowed and used: a large feature keeps its own `_components/`
subfolder for its parts.

## Data access

**`src/lib/api.ts` is the only place that calls `fetch`.** `apiFetch<T>`:

- prefixes `API_BASE` (`NEXT_PUBLIC_API_BASE`, default `http://localhost:3001`);
- sets `content-type: application/json` **only when a body is present** — a
  body-less POST otherwise trips Fastify's empty-body check;
- normalises every failure into `ApiError` with `status`, `code`, `details`,
  unwrapping the API's `{ error: { … } }` envelope;
- turns a network failure into `ApiError` with status `0` and code
  `network_error`, so "the API is down" is distinguishable from "the API said no".

Components branch on `ApiError.status` to choose the error surface — toast,
inline or full-screen.

**Every hook lives in `src/lib/hooks/`**, grouped by domain (`core`, `agents`,
`reviews`, `trace`, `repo-intel`) and re-exported by `hooks/index.ts`. Import from
`@/lib/hooks` for platform hooks or from the domain file directly; both resolve.

Adding an endpoint means: a function in `api.ts` → a hook in `hooks/<domain>.ts` →
the component consumes the hook.

## Copy and primitives

- Every user-facing string goes through `next-intl`. Messages live in
  `messages/<locale>/<namespace>.json`, one namespace per feature area. Never
  inline copy in a component.
- UI primitives come from `@devdigest/ui` (`src/vendor/ui`), contracts from
  `@devdigest/shared` (`src/vendor/shared`). Import via the alias; both are
  vendored copies, not packages.

## Testing

Tests run under vitest + jsdom with `fetch` mocked — no API, no browser. Test the
component through its rendered output and user interactions, not its internals;
put pure logic in `helpers.ts` and test it directly.

Real end-to-end journeys against a live stack live in `../../e2e`, not here.
