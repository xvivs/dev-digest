# ADR 0019 — A fixed pipeline of scoped dev subagents with nested skeptics and a hook-enforced write guard

**Status:** proposed
**Date:** 2026-09-30
**Relates to:** ADR 0004 (AGENTS.md as instructions source), ADR 0006 / 0014 (self-review gate)

## Context

Agents write most of the code for lessons L03-L08. Delegation used to be ad
hoc: one general-purpose agent planned, implemented and reviewed its own work in
a single context. Three failures kept recurring:

- A reviewer that shares the author's context approves the author's
  assumptions.
- Unverified CRITICAL findings block branches, and noise teaches people to
  ignore reviews. `pr-self-review` already answers this with an `opus` skeptic
  per CRITICAL (ADR 0006).
- Scope drift: a "test" agent edits production code to make its test pass; a
  planner starts writing the implementation.

Claude Code 2.1.2xx allows three facts to be relied on. Subagents can nest (3
layers by default). Frontmatter can preload skills. Frontmatter `PreToolUse`
hooks apply only while that agent runs. Path-scoped rules such as
`Edit(docs/**)` do not exist in a subagent's `tools`, and `Agent(x)` allowlists
are ignored there.

## Decision

1. **Single-purpose agents** (16 as of this ADR's last amendment) in `.claude/agents/`, each with owned and
   not-owned work, a fixed output format and a word cap. The roster, chains and
   routing live in `docs/dev-agents.md`.
2. **A fixed pipeline, not a team or a dynamic workflow.** The roles are known
   and the handoffs are short. Parallelism exists only where two stages read
   the same finished artifact: architecture review ∥ test writing after
   implementation (the orchestrator commits first, and the reviewer reads that
   commit, not the working tree test-writer is changing), and plan-critic ∥ architecture review on a draft spec.
3. **Nested skeptics.** Planners loop through `plan-critic` and
   `architecture-reviewer` (PLAN mode) until neither reports a CRITICAL or
   MAJOR/HIGH finding, capped at 3 rounds. Every reviewer sends every finding
   to a `finding-verifier` before returning. The deepest path is exactly 3
   layers.
4. **Best-practice skills are passed, not hoped for.** Implementers preload the
   backend and frontend skills. Planners pick a `Skills:` list from the change
   sites and pass the same list to both plan reviewers, and reviewers pass it
   on to the skeptic.
5. **Write scope is enforced by one hook**, `.claude/hooks/agent-guard.mjs`,
   with profiles `readonly | specs | tests | docs | insights | impl`. It also
   protects paths that no agent may write and blocks git history and publishing
   commands for all agents. Read-only agents additionally drop `Edit`/`Write`
   from `tools`.
6. **Model by work.** `opus` for judgment (plans, architecture and security
   verdicts, skeptics), `sonnet` for execution and evidence, `haiku` for
   sweeps. Aliases only.
7. **Agents never commit or write INSIGHTS.** The orchestrator commits and files
   the `Insight candidates` every report carries through `engineering-insights`.
   The one exception is `insight-curator`, which works in that skill's Cleanup
   mode.

## Consequences

- A feature costs more tokens: a plan review round is 2 `opus` agents plus one
  `opus` skeptic per architecture finding. Budget roughly 3 rounds for a new
  module. The pay-off is fewer rework cycles after implementation.
- Reports are machine-shaped, so the orchestrator can route findings without
  re-reading the code.
- The guard is defense in depth. `node -e` writes and similar bypasses are not
  parsed. If the workspace trust dialog hasn't been accepted, frontmatter hooks
  are skipped, so the guard depends on it.
- Raising `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is unnecessary. Lowering it
  below 3 degrades the plan loop's skeptic to a self-check, which the prompts
  report.
- Changing a write scope means changing a guard profile and its test.

## Alternatives considered

| Option | Why not |
|---|---|
| One general agent per stage, no role files | No fixed output formats or scopes; scope drift and self-approval stay |
| Agent Team / dynamic workflow | The roles are fixed and the transitions are linear. A team adds coordination cost and state without buying parallelism the pipeline doesn't have |
| Path rules via `permissions` in `.claude/settings.json` | Session-wide: they can't differ per agent, and would restrict the main session too |
| Skeptic only for CRITICAL (as in pr-self-review) | Leaves HIGH/MEDIUM noise that erodes trust in the reviews; the extra cost is bounded by the 25-finding caps |
| Separate guard script per agent | Fifteen near-identical scripts drift; profiles in one tested file don't |
