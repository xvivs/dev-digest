---
name: api-breaking-change
description: Use when a PR changes an HTTP route's path, params, request or response schema, or status codes. Flags a renamed or removed param, a field that becomes required, a renamed/reshaped response field, or a status-code change shipped with no versioning or deprecation path.
type: rubric
---

# API Breaking Change

An HTTP contract is a promise to callers you cannot see. This skill flags any
change to that contract that ships without a way for an existing caller to
keep working.

## What counts as breaking

- **Path or param renamed or removed** — a route segment or `:param` name
  changes, or a param disappears. Any client building the URL, or any
  server-side handler reading the old param name, breaks silently (often as
  a 404 or an `undefined` read, not a clear error).
- **Optional becomes required** — a request field that had a default or was
  allowed to be absent now fails validation when omitted. Every caller that
  relied on the old default gets a new 4xx it did not get yesterday.
- **Response field renamed, retyped, or removed** — `snake_case` ↔
  `camelCase`, a type change (string → number, singular → array), or a key
  dropped. Any client parsing the old key breaks, usually with no error at
  all — just a `undefined` where a value used to be.
- **Response shape changed** — an array becoming an object (or the reverse),
  a wrapper added or removed, pagination introduced where none existed.
- **Status code changed** — a success path's code changes, or a new
  rejection code appears for input that used to be accepted.

## What to check once you find one

For each breaking change, name the exact old shape and the exact new shape,
then look for a way the diff gives existing callers to transition: an API
version segment or header, a deprecation notice left on the old shape for a
transition window, or both old and new fields accepted at once. If none of
these is present, this is a hard break shipped with no migration path — the
highest severity your reviewing agent uses.

## What NOT to flag

A strictly additive change — a new optional field, a new route, a new
optional query parameter — is not breaking. A rename confined to an internal
type that is never serialized over HTTP is not breaking either: check that
the field actually crosses the wire before reporting it.
