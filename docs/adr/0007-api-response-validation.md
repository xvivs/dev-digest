# ADR 0007 — Validate API responses with zod in dev and test

**Status:** accepted (mechanism shipped; endpoint wiring blocked, see Consequences)
**Date:** 2026-09-28

## Context

`apiFetch` returned `(await res.json()) as T`. The zod contracts in
`@devdigest/shared` never ran on the client, although the vendored copies in
`server/` and `client/` already differ in five files (ADR 0001). When the
server drops or renames a field, the UI reads `undefined` several components
away from the fetch, and no test fails.

## Decision

1. `apiFetch<T>(path, init?, schema?)` and `api.get|post|put|patch|del` take
   an optional trailing `ResponseSchema<T>` (a zod type with output `T` and
   `unknown` input). Existing calls compile unchanged.
2. `apiFetch` parses the body only when `process.env.NODE_ENV !== "production"`.
   It uses the schema as written, with no `.strict()` and no `.passthrough()`.
3. A body that fails to parse throws
   `ApiError(status = res.status, code = "invalid_response", details = issues)`.
4. `api.ts` imports zod as a type only, so the transport adds no zod code to
   the bundle.
5. The first endpoints to opt in are the `reviews` and `pulls` hooks.

## Consequences

### What this enables

- A vitest or e2e run fails at the fetch when a response breaks its contract.
- Production pays nothing and survives additive server changes.

### What this costs

- Dev and production behave differently. A drift that only prod data
  triggers still slips through.
- Wiring is blocked today. The schemas the reviews and pulls hooks need
  (`ReviewRecord`, `RunSummary`, `PrMeta`, `PrDetail`, `PrReviewComment`,
  `ReviewRunResponse`) live in contract files that import siblings with `.js`
  specifiers. Next's webpack cannot resolve those without
  `resolve.extensionAlias` (client INSIGHTS, "Module not found ...
  contracts/findings.js"). A value import from a hook would 500 every route in
  `next dev` while tsc and vitest stay green. Adding
  `extensionAlias: { ".js": [".ts", ".js"] }` to `client/next.config.mjs`
  unblocks it; verify the change in a browser, not only in tests.

### What this forbids

- `.passthrough()` or loosened schemas added to make a failing parse pass.
  Fix the drift in both vendored copies instead.
- Parsing in production without a new decision.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Keep `as T` | Zero cost | Drift surfaces as `undefined` deep in the UI |
| **Parse in dev/test only (chosen)** | Catches drift in tests and e2e at no prod cost | Two behaviours per environment |
| Parse everywhere | Strongest guarantee | Cost on large payloads; a strict parse breaks the UI on additive changes |
