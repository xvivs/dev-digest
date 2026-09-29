---
name: deprecation-policy
description: Use when a PR removes, replaces or stops populating a response field, request field, route or enum member. Requires a deprecation window first: @deprecated JSDoc, Deprecation and Sunset headers, and the old and new field written side by side for N releases. Flags silent removal.
type: rubric
---

# Deprecation Policy

Removal is the last step of a deprecation, never the first. Callers cannot
read your diff. They learn about a removal from a production error.

## The path

1. **Mark.** Put `@deprecated` JSDoc on the old field in the type or zod
   schema, naming the replacement and the removal version.
2. **Signal.** Send `Deprecation: true` and `Sunset: <HTTP-date>` headers on
   routes that carry the old shape. Add a `Link: <...>; rel="successor-version"`
   when a new route exists.
3. **Dual-write.** Emit the old and the new field together for N releases
   (state N, at least one minor). Accept both on requests.
4. **Remove** in the next major, with the changelog entry.

## What to flag

- A field, route or enum member deleted, with no earlier `@deprecated` in the
  repo history you can see and none added in this diff.
- A field still declared but no longer filled (always `null`, `[]` or `''`):
  same silent removal.
- Rename without dual-write.
- `@deprecated` present but no removal version or no replacement named.
- Removal in the same PR that adds the deprecation.

## How to report

Finding: `file:line` of the removed or emptied field, the client code that
reads it (search the client tree), and the requirement: restore the field,
mark it `@deprecated` and dual-write, or ship the removal in a major bump
(`semver-discipline`). Silent removal is a contract violation even when
every in-repo caller was updated, because external callers exist.

## Bad

```ts
// helpers.ts: mapper output
-    agent_name: agentName ?? null,
```

`RunHistory` falls back to a generic label, so nothing crashes and the
regression is invisible. No `@deprecated`, no window, no bump. Flag it.

## Good

```ts
export interface ReviewDto {
  /** @deprecated use agent.name. Removed in 2.0.0. */
  agent_name?: string | null;
  agent?: { id: string; name: string } | null;
}
// mapper writes both
agent_name: agentName ?? null,
agent: review.agentId ? { id: review.agentId, name: agentName ?? '' } : null,
```

```ts
reply.header('Deprecation', 'true').header('Sunset', 'Wed, 31 Mar 2027 00:00:00 GMT');
```
