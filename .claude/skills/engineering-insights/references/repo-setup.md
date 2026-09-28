# Bootstrapping or migrating a module's INSIGHTS.md

Reached from `SKILL.md` step 4 in two cases: no `INSIGHTS.md` exists yet
anywhere in the repo, or one exists but predates the 7-section shape (no
`## What Works` heading — e.g. an older flat `Symptom/Cause/Fix` journal).

## Blank-file skeleton

Use this verbatim for a module with no file at all:

```markdown
# INSIGHTS — <scope>

<one or two sentences: what this journal is for, and what "cross-boundary"
findings should route elsewhere instead — mirror whatever sibling files in
this repo already say, or write fresh for a brand-new repo>

Priority: <this module's one-sentence "look especially for" nuance, if one
is obvious from the module's nature — e.g. flakiness for an e2e suite,
silent degradation for a pipeline that fails without throwing. Omit the
line entirely if nothing module-specific applies.>

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly
cleanup — lives in the engineering-insights skill).

## What Works
## What Doesn't Work
## Codebase Patterns
## Tool & Library Notes
## Recurring Errors & Fixes
## Session Notes
## Open Questions
```

## Migrating an older-shaped file in place

1. Keep every line above the file's first `##` heading verbatim — title,
   intro, scope note. That prose is almost always still true and worth
   keeping.
2. If the old file's "When to write" section (or equivalent) states a
   module-specific nuance beyond the generic "anything that surprised you"
   line, fold it into a one-line `Priority:` sentence placed with the intro,
   above the "Append-only" line.
3. Replace everything from the first `##` heading onward with the 7-section
   skeleton above (empty headings, in that fixed order).
4. If the old file had real dated entries (not just a commented-out example
   or a "_No entries yet._" placeholder), classify each one into the section
   it best fits per `SKILL.md`'s classification table and re-file it in the
   new shape — do not discard real recorded findings during a migration.

## Closing the loop in CLAUDE.md

One-time, per module, done alongside the file migration/bootstrap — this
edits a file that's loaded every session, so treat it as a setup step to
confirm with the user rather than something the live skill does silently on
every run.

In the module's `CLAUDE.md`, in its "Read when" section (or equivalent),
replace any existing discretionary INSIGHTS.md bullet with an unconditional
one:

```
- Read `INSIGHTS.md` before starting work here — treat it as high-confidence
  guidance unless this file says otherwise.
```

and add one new final section:

```
## Before you finish

File anything durable you learned this session into `INSIGHTS.md` **through
the `engineering-insights` skill** — don't skip this step, and don't edit the
file by hand.
```

If the module's `CLAUDE.md` fans out to more than one `INSIGHTS.md` (a root
file covering several packages), phrase the bullet to route to the right one:
*"Read the touched package's `INSIGHTS.md` (or the root one for cross-package
concerns) before starting work there..."*
