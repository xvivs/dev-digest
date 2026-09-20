# docs/ — repo-wide

Cross-package architecture and decisions: things true of more than one package,
and things that stay true for a long time.

Put here what needs more than ~3 lines to explain, then point at it from
`CLAUDE.md` with a `Read X when Y` line. Package-local architecture belongs in
`<package>/docs/` instead.

- `adr/` — architectural decision records (Context → Decision → Consequences →
  Alternatives considered). One file per decision, numbered, never rewritten —
  superseded by a newer ADR.
- `agent-prompts/` — the reviewer system prompts shipped with the starter.

Not here: plans for unbuilt work (`specs/`), raw debugging findings
(`INSIGHTS.md`), or usage instructions (`README.md`).
