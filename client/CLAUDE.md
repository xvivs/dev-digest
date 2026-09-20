# client — `@devdigest/web`

Next 15 App Router studio over the Fastify API. Server/Client components,
data through TanStack Query.

## Rules

- Every network call goes through `src/lib/api.ts` (`apiFetch`). It normalises
  failures into `ApiError` with a status, so the error UX can branch on it.
  Never call `fetch` directly from a component.
- Every data hook lives in `src/lib/hooks/*` and is re-exported by
  `hooks/index.ts`. Components consume hooks, not `apiFetch`.
- Pages stay thin. Feature logic lives in a colocated folder next to the route:
  `_components/<Name>/` with `<Name>.tsx`, `index.ts`, and — where there is
  behaviour — `<Name>.test.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`.
- User-facing strings go through `next-intl`. Messages live in
  `messages/<locale>/<namespace>.json`. Do not inline copy in components.
- UI primitives come from `src/vendor/ui` (`@devdigest/ui`). Contracts come from
  `src/vendor/shared` (`@devdigest/shared`). Import via the alias, not a relative path.
- Cross-cutting chrome (nav, breadcrumbs, `g`-then-key shortcuts) lives in
  `src/components/app-shell`.

## Gotchas

- `src/vendor/shared` is a **copy** of the server's contracts, not a package.
  There is no sync script and the two have already diverged. Change both.
- `apiFetch` only sets `content-type: application/json` when a body is present —
  a body-less POST otherwise trips Fastify's empty-body check.
- Tests run under vitest + jsdom with `fetch` mocked: they need neither the API
  nor a browser. Real journeys live in `../e2e`.
- Many `messages/en/*.json` namespaces (blast, brief, ci, eval, memory, skills,
  conventions, compose, conformance, agentPerformance) belong to screens that do
  not exist yet. Unused ≠ dead.
- `src/components/showcase` is a dev-only design-system gallery used by the smoke
  test. Its header comment mentions a `/showcase` route that no longer exists.

## Do not touch

- `src/vendor/**` — vendored UI kit and contracts. Contract changes must land in
  `server/src/vendor/shared` too.
- Unused `messages/en/*.json` namespaces — lesson scaffolding.

## Read when

- Read `README.md` for the UI route map and which API each route leans on.
- Read `docs/component-anatomy.md` before adding a route or a feature component.
- Read `../server/README.md` when you need the exact API contract behind a hook.
- Read `INSIGHTS.md` before starting work here and note which entries are
  relevant — treat it as high-confidence guidance unless this file says
  otherwise.

## Before you finish

File anything durable you learned this session into `INSIGHTS.md` **through
the `engineering-insights` skill** — don't skip this step, and don't edit the
file by hand. Hand-written entries land undated, unreferenced and in the wrong
section, and nothing catches it until someone audits the file months later.
