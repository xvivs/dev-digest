# Prompt anatomy

What makes a dev agent good, section by section. The techniques come from
reading the oh-my-claudecode agents (github.com/Yeachan-Heo/oh-my-claudecode,
`agents/`) and from what broke while building the first 15 agents here.

## Section order

1. **Identity line.** "You are the **X**." plus one sentence of stance ("You
   find and trace, you do not judge"). The stance line does more than the
   title.
2. **Owned / not owned.** "You are responsible for: …" and "You are not
   responsible for: … (`owner-agent`)". Every excluded job names its owner, so
   the agent hands off instead of silently doing it or dropping it. This single
   technique prevents most scope drift.
3. **Why it matters.** 2-3 sentences on the cost of this agent's typical
   failure ("a false approval costs 10-100x a false rejection", "a test that
   can't fail turns coverage into false confidence"). Models follow rules they
   understand the reason for; bare rules get rationalised away.
4. **Inputs.** What the delegation prompt carries: spec path, diff base,
   finding block, `Skills:`, round number. Say what to do when an input is
   missing (usually `BLOCKED` or `UNCERTAIN`, never a guess).
5. **Repo facts it would otherwise re-derive.** Paths, commands, conventions
   relevant to *this* role only. Take them from AGENTS.md, READMEs and
   INSIGHTS, never from memory, and verify each path exists.
6. **Protocol.** Numbered steps, each an action with its evidence. Include:
   - *pre-commitment* for reviewers: predict the 3-5 likely problems before
     reading, then check them first (turns passive reading into search);
   - *deterministic first*: run commands (typecheck, arch:check, audit) before
     LLM judgment;
   - *gap analysis*: look for what's missing, not only what's wrong;
   - *self-audit*: before the final message, try to refute your own
     CRITICAL/HIGH; a preference becomes LOW; never downgrade data loss or a
     security issue without `Mitigated by: <path:line>`;
   - a **stop condition**: "3 failed attempts → PARTIAL with output", "two
     search rounds with nothing new → report the gap".
7. **Delegation.** Who it may spawn, for what, with which 5-block prompt
   (role, input, prohibitions, output format, size cap), in waves of ≤4,
   independent children in one message. The fallback at the depth limit. The
   `Spawns:` line.
8. **Rules.** The repo rules this role could break, where it would break them.
   The last rules are always: no commits, never write `INSIGHTS.md`.
9. **Output format.** A fenced skeleton with fixed headings, enum verdicts,
   tables for anything comparable, "(or "none")" for empty sections, a word
   cap, and "in the language of the delegation prompt". The final message *is*
   the deliverable, never "done".

## Contracts other agents depend on (copy, don't paraphrase)

| Contract | Producer → consumer | Where to copy from |
|---|---|---|
| Finding block (`id`, `Where`, claim, `Severity`, `Confidence`) | reviewers → `finding-verifier` | `security-reviewer.md` |
| Verifier verdict `CONFIRMED / REFUTED / UNCERTAIN` + corrected severity | `finding-verifier` → reviewers | `finding-verifier.md` |
| Spec-compliance block (`AC-n`, `Spec says`, `Found`) | `plan-verifier` → `finding-verifier` | `plan-verifier.md` |
| Plan verdicts `REJECT / REVISE / ACCEPT`, `APPROVE / REQUEST_CHANGES` | plan reviewers → planners | `plan-critic.md`, `architecture-reviewer.md` |
| `Status: DONE / PARTIAL / BLOCKED` + `Fixes` table | implementers → main | `implementer.md` |
| `Insight candidates` | everyone → main → `engineering-insights` | any agent |

When you change a contract, change every producer and consumer in the same
edit, and run a fresh cross-review.

## Techniques worth their tokens

- **Forbidden vocabulary as evidence:** "should / probably / seems / the
  implementer said" disqualifies a claim.
- **Fact / inference / unknown** kept apart in the report (investigators,
  researchers). An inference must never be promoted to a fact.
- **Severity with definitions and a cap rule:** CRITICAL only with HIGH
  confidence and a concrete path. Keep the CRITICAL/HIGH/MEDIUM/LOW scale from
  pr-self-review so verdicts compose across agents.
- **"Zero findings is a valid answer"**, and it comes with the list of what was
  checked. That kills padding.
- **Verdict as a pure function** of the surviving findings, stated in the
  prompt. The model doesn't vibe the verdict.
- **Caps on output** (findings ≤25, words ≤N) with an explicit overflow
  rule ("fold the rest into one MEDIUM `truncated`").

## Failure modes seen here

| Symptom | Cause | Fix in the prompt |
|---|---|---|
| Review loop always runs 3 rounds | reviewer not given the previous findings and the planner's rejections | pass them; "don't re-raise a finding rejected with evidence unless you refute the evidence" |
| Reviewer reads a diff that changes under it | parallel stage writing files | orchestrator commits first; reviewer reads that commit |
| Implementer can't act on findings | only a "follow the spec" mode | add a fix-round mode with its own scope and table |
| Verifier returns UNCERTAIN for every dependency finding | read-only rules forbade the registry queries it needs | name the exact read-only commands it may run |
| `$TMPDIR/x` redirect denied | the guard doesn't expand variables | tell the agent to use absolute temp paths |
| A spawn storm hits the 20-agent limit | parallel reviewers × waves × sub-sub-agents | waves ≤4, `no sub-spawn` for lookup children |
| Agent claims "done" with nothing checked | no output contract | fixed skeleton, fresh-evidence rule |
