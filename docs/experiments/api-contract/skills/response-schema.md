---
name: response-schema
description: Use when a PR changes what a JSON response carries, including a zod response schema, a shared contract type, or a DTO mapper in helpers.ts, service.ts or a mapper file outside the route. Flags a renamed, retyped or removed response field, nullable or optional flipped to required or back, enum narrowing or widening, and a changed date or number format.
type: rubric
---

# Response Schema

The route file is not the only place the response is shaped. A mapper such as
`findingRowToDto`, a shared zod contract and a Drizzle-to-DTO function all decide
which keys clients read. Read them all, even when the diff never touches `routes.ts`.

## What to flag

- **Key renamed in a mapper.** `start_line: row.startLine` becomes
  `line_start: row.startLine`. The type may still compile, because the
  interface changed with it. Every client reading the old key gets `undefined`.
- **Type changed.** string to number, scalar to array, `Date` string to epoch,
  `'2026-09-28T10:00:00Z'` to `'2026-09-28'`, integer cents to a decimal.
- **Nullability flipped.** A field that could be `null` or absent becomes
  always present (safe for readers) or a field that was always present becomes
  `nullish()` (breaks readers that skip the null check).
- **Enum narrowed.** A member removed from a `z.enum([...])` that responses
  emit. A client `switch` or a lookup table keyed by it hits an unknown case.
  **Enum widened.** A new member breaks exhaustive `switch` clients, so it
  needs a minor bump and a release note.
- **Field removed** from the DTO or from the mapper output. See
  `deprecation-policy` for the required path, `semver-discipline` for the bump.

## How to report

One finding per change. State: `file:line` of the mapper or schema line, the
old and new key or type, which client code reads it if visible in the repo
(search the client for the key), and the requirement: major bump, or keep the
old field alongside the new one. If the field never leaves the server, say
so and do not flag it.

## Bad

```ts
// server/src/modules/reviews/helpers.ts
return {
  id: row.id,
-  start_line: row.startLine,
-  end_line: row.endLine,
+  line_start: row.startLine,
+  line_end: row.endLine,
};
```

Finding: `helpers.ts:41` renames `start_line` and `end_line` on every finding.
`FindingCard` builds the GitHub link from `f.start_line`, so links lose the line
anchor with no error. Requires a major bump, or emit both names for N releases.

## Good

```ts
return {
  id: row.id,
  start_line: row.startLine,
  end_line: row.endLine,
  /** @deprecated use start_line. Removed in 2.0.0. */
  line_start: row.startLine,
};
```

Additive, old key intact, deprecation recorded. Flag nothing except a missing
minor bump if `package.json` still shows the old version.
