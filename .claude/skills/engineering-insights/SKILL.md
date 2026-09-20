---
name: engineering-insights
description: Captures durable engineering learnings into the touched module's INSIGHTS.md — non-obvious fixes, dead ends, codebase conventions, library quirks, recurring errors. Fires two ways — capture-as-you-go, the moment something surprising or hard-won happens mid-task, and wrap-up, at the end of any substantive session with a real problem, decision, or dead end (skip trivial tweaks). Also runs on /engineering-insights, or on a request to review or prune a module's INSIGHTS.md.
---

Knowledge that lives only in this session's context dies with it. This skill's
job is narrow: recognize when something just learned is worth keeping, find
the right module's `INSIGHTS.md`, and file it under the matching section — never
inventing a new journal format, never touching `CLAUDE.md` on its own.

## Steps

1. **Decide the trigger.** An explicit request to review or prune a file →
   Cleanup mode (`references/cleanup-and-sharding.md`), stop here otherwise.
   Else: is this **capture-as-you-go** (something just surprised you, broke
   non-obviously, or the obvious fix turned out wrong) or **wrap-up** (the
   session or task is ending)? If neither, stop — there is nothing to do.
2. **Screen every candidate** against the quality bar below. Discard anything
   that fails it. If more than 5 survive from a single trigger, keep only the
   top 5 by the section-classification precedence below and say in the report
   how many were dropped — better one sharp entry than five soft ones.
3. **Classify** each survivor into exactly one of the 7 sections below, using
   the precedence table to break ties. Never file the same fact in two
   sections.
4. **Resolve the target file**: walk up from the touched or discussed path to
   the nearest `INSIGHTS.md`. If none exists anywhere in the repo, ask once
   whether to bootstrap one (`references/repo-setup.md`); on "no", do nothing
   for the rest of the session and don't ask again.
5. **Check for a near-duplicate** in the target section first — same
   underlying file or mechanism already described. If found, skip writing and
   note "already recorded" in the report instead. Otherwise insert per the
   mechanics below.
6. **Wrap-up only**: additionally write one dated Session Notes entry per
   module actually touched this session.
7. **Report back**: one line per file touched, naming the section(s) written,
   any duplicates skipped, and — as a mention, never an edit — flag if a
   Recurring Errors & Fixes entry looks like a repeat worth a `CLAUDE.md` line.

**Completion criterion**: every candidate surviving step 1 is either (a)
appended under the correct section of the correct module's `INSIGHTS.md`
using the entry template, or (b) explicitly named as rejected and why (quality
bar or duplicate) — and for a wrap-up, exactly one dated Session Notes entry
exists for today in every module actually touched. Silently doing nothing is
never a valid stopping point: always report which of (a)/(b) happened.

## Quality bar

Test: **if it would be obvious to anyone reading the code, don't write it.**

- Reject — *"Promises can be tricky."* / *"Be careful with async."* Generic,
  not tied to anything in this codebase, not actionable.
- Accept — *"`Promise.all()` on the ingest pipeline times out after 30 items —
  use `Promise.allSettled()` in batches of 10."* / *"Checkout-flow state
  always goes through Zustand (`cartStore.ts`) — 3 components share the cart;
  local state doesn't work here."*
- Reject anything already stated in a `README`, `CLAUDE.md`, or `docs/` file
  loaded automatically — this file is for what nothing else already says.

## Section classification

Fixed order below doubles as tie-break precedence when a candidate could fit
more than one — pick the first match, never duplicate across sections.

| # | Section | What goes here |
|---|---|---|
| 1 | Recurring Errors & Fixes | A specific error/symptom you could pattern-match on again, with its fix |
| 2 | Tool & Library Notes | A third-party dependency or tool behaving unexpectedly — not our code |
| 3 | Codebase Patterns | An existing convention or architectural rule this codebase already follows |
| 4 | What Doesn't Work | An approach that failed or was a dead end — most valuable, most often skipped |
| 5 | What Works | An approach that succeeded non-obviously |
| 6 | Open Questions | A real unresolved question, not a fact |
| 7 | Session Notes | Wrap-up narrative only — never treated as authoritative |

## Entry format

```markdown
- **<one-line, specific, testable claim>** — <mechanism/why, with a `path/to/file.ts:NN` reference when applicable>. _(YYYY-MM-DD)_
```

Session Notes uses a dated sub-heading instead of a bullet:

```markdown
### YYYY-MM-DD — <module> session
<2-4 sentences: what was attempted, what shipped, what's left.>
```

## Insertion mechanics

Insertion is deterministic, not something an LLM re-derives via text editing
every time — that's what breaks markdown structure across many sessions.
Write the finished entry text to a temp file, then invoke (resolve the repo
root first so this works regardless of your current working directory or
which worktree you're in):

```bash
ROOT="$(git rev-parse --show-toplevel)"
node "$ROOT/.claude/skills/engineering-insights/scripts/insert-entry.mjs" \
  --file <path/to/INSIGHTS.md> --section "<Section Name>" --entry-file <path>
```

The script finds the section, self-heals a missing or fully-absent heading
structure, inserts at the end of that section's block, and reports a single
JSON line on stdout. Branch on its `status`:

- `inserted` — done. Check `duplicateHeadingWarning`: if non-null, add one
  Open Questions entry naming it, for a human to dedupe during cleanup. Check
  `crossedThreshold`: if `true`, invoke the script a second time targeting
  `"Open Questions"` with an entry flagging the file as a sharding candidate
  (see `references/cleanup-and-sharding.md`) — never split automatically.
- `duplicate` (exit code 2) — the exact entry text already exists in that
  section; the file was left untouched. This is a cheap exact-string
  backstop only — the semantic near-duplicate judgment call (step 5 above)
  is still yours, made *before* invoking the script.
- `error` (exit code 1) — bad arguments or a missing file; read `message` and
  fix the call rather than falling back to editing the file by hand.

The script never edits or deletes a byte that existed before the insertion
(besides normalizing surrounding blank-line spacing) during normal capture.
Deletion is reserved for Cleanup mode only, done by hand.

## Conflicts

Checked live, on every run — not deferred to cleanup: if two entries anywhere
in the file clearly disagree, don't silently pick a winner. Add a new Open
Questions entry naming the conflict, for a human to resolve during cleanup.
When an in-the-moment judgment call is unavoidable, weigh by the section
precedence order above — Session Notes is never authoritative.

## Bootstrapping or migrating a file

Reached only when step 4 finds no `INSIGHTS.md`, or finds one that predates
this 7-section shape (no `## What Works` heading). See
`references/repo-setup.md` for the blank skeleton, the one-time `CLAUDE.md`
diff that closes the read/update loop, and the migration checklist for
converting an older-shaped file in place without losing its intro or
module-specific priority note.
