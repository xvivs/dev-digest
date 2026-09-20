# Cleanup and sharding

Reached from `SKILL.md` only on an explicit request to review/prune a file, or
when live insertion flags a ~200-entry crossing. Both actions here are
human-gated — they're allowed to delete or restructure, which normal capture
never is.

## Monthly cleanup

A prune/merge/dedupe pass, run as its own reviewed commit, never mixed into
feature work — e.g. `chore(insights): monthly cleanup — <module>/INSIGHTS.md`.
Safe to be destructive here specifically because the file is git-versioned:
nothing is actually lost, and the diff is reviewable before it lands.

When asked to run this:

1. Read the whole file. For each section, look for: entries that no longer
   apply (the code they describe was since removed or rewritten), near-exact
   duplicates that capture drift let slip past the live duplicate check,
   and Open Questions entries that have since been answered elsewhere in the
   file (resolve them: fold the answer into the relevant section, remove the
   question).
2. Resolve any standing conflicts flagged in Open Questions (per `SKILL.md`'s
   "Conflicts and file size" — those exist precisely so a human decides them
   here rather than the agent guessing during capture).
3. Merge entries that describe the same underlying fact from different
   angles into one, keeping the more specific wording.
4. Leave everything else untouched. This pass edits for accuracy and
   redundancy, not style — don't rewrite entries that are still correct just
   to tidy phrasing.
5. Summarize what changed (counts: removed, merged, resolved) in the commit
   message, not as a new INSIGHTS.md entry.

## Sharding past ~200 entries

The live skill only flags this (an Open Questions note); it never splits
automatically. When asked to actually do the split:

1. Pick a domain boundary that's actually load-bearing for this module (e.g.
   `Auth`, `Database`) — not an arbitrary count-based cut. If no natural
   domain split exists yet, it's fine to wait until one does.
2. Create `<module>/INSIGHTS-<Domain>.md` with the full 7-section skeleton
   from `repo-setup.md`.
3. Move (not copy) every entry belonging to that domain into the new file,
   preserving its original date.
4. Leave one line in the base file's relevant section pointing at the new
   one: `See INSIGHTS-<Domain>.md for <domain>-specific learnings.`
5. Keep the base file alive for entries that don't cleanly belong to any
   shard — don't force every future entry into a shard just because one
   exists.

## Optional: reviving a promotion signal

Some predecessor learnings formats use a mechanical "hit it twice, escalate a
one-liner to CLAUDE.md" rule. The 7-section shape here doesn't carry an
equivalent, and `SKILL.md` only asks the agent to *mention* a suspected
repeat, never to edit `CLAUDE.md` on its own. If a monthly cleanup
turns up a Recurring Errors & Fixes entry that keeps proving itself
(mentioned, re-hit, still not common knowledge), it's a reasonable judgment
call to promote it to a `CLAUDE.md` line by hand during that same reviewed
commit — this is optional and per-entry, not a rule the live skill enforces.
