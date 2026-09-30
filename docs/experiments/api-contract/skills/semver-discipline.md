---
name: semver-discipline
description: Use when a PR changes an HTTP contract, a shared zod schema or a response DTO of a versioned package. Checks that package.json version and CHANGELOG match the change class: major for breaking, minor for additive, patch for fixes. Flags a breaking change with no major bump or no changelog entry.
type: rubric
---

# Semver Discipline

A contract change is only as safe as the version that announces it. Classify
the change, then check the diff for the matching version and changelog edit.

## Classification

| Change | Bump |
|---|---|
| Field, route or enum member removed. Field renamed. Optional made required. Enum narrowed. Type or format changed. | **major** |
| New optional request field, new response field, new route, enum member added | **minor** |
| Bug fix, no visible contract change | **patch** |

At `0.x` the same rules apply: a breaking change still needs at least a minor
bump and an explicit changelog line marked BREAKING. `0.0.0` staying `0.0.0`
after a breaking change is a finding.

## What to flag

- Breaking change and `package.json` `version` unchanged in the diff.
- Bump smaller than the class (minor for a rename, patch for a removal).
- No `CHANGELOG.md` entry, or an entry that does not say BREAKING and does not
  name the old and the new shape. If the repo has no changelog file, the PR
  description must carry the note. Say which one is missing.
- A major bump with no removal path described. Bumping is not a substitute for
  telling callers what to change.

## How to report

Finding: `file:line` of the breaking change (not of `package.json`), the
class, the required bump, and the client impact in one sentence. Suggested
comment:

> Breaking: `<old>` -> `<new>` at `<file:line>`. Clients reading `<old>` get
> `undefined`. Requires a major bump in `package.json` and a BREAKING entry in
> the changelog, or a dual-write deprecation path (see `deprecation-policy`).

## Bad

```jsonc
// package.json: unchanged, "version": "1.4.2"
// helpers.ts: severity 'SUGGESTION' removed from Severity
```

Silent major change under a patch-level version. Flag it.

## Good

```jsonc
// package.json
-  "version": "1.4.2",
+  "version": "2.0.0",
// CHANGELOG.md
+ ## 2.0.0
+ - BREAKING: `Severity` no longer includes `SUGGESTION`. Map it to `WARNING`.
```

Version, class and migration note agree. Do not flag.
