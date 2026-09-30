---
name: agent-authoring
description: Create, change or review a Claude Code subagent in .claude/agents/ for DevDigest — decide whether it should be an agent at all, place it in the pipeline (who spawns it, what it spawns, depth and concurrency), pick model, tools, write-guard profile and preloaded skills, write the prompt from the house template, register it in docs/dev-agents.md, and prove it with the validator, the guard tests and a live smoke run. Use whenever someone asks for a new agent/subagent/role, edits an agent file, adds a write scope to agent-guard.mjs, or asks why an agent misbehaves.
---

# Agent authoring

Every dev agent in this repo follows one system: fixed roles, a write guard
per profile, nested skeptics, machine-shaped reports (`docs/dev-agents.md`,
ADR 0019). This skill is the checklist for adding one without breaking that
system. Claude Code checks almost none of it. It silently ignores unknown
fields and `Agent(x)` allowlists, skips files whose YAML doesn't parse, and
skips project-agent hooks when the workspace isn't trusted.

## Steps

Do them in order. Each step's output feeds the next.

### 0. Read the system

Read `docs/dev-agents.md` (roster, chains, guard profiles, limits), ADR 0019,
and the existing agent closest to the new one. Read
`references/platform-facts.md` once per session. It holds the verified
platform behaviour that everything below relies on.

### 1. Should this be an agent?

| The need | Build | Not an agent because |
|---|---|---|
| Knowledge or a checklist applied inside someone else's work | a **skill** | an agent can't share the caller's context; a skill can |
| A one-off delegation | an ad-hoc `Agent` call with a 5-block prompt | a file costs maintenance, a prompt doesn't |
| A repeated role with its own context, tool limits and output contract | an **agent** | — |
| An existing role, slightly wider | **extend** that agent | two agents with overlapping jobs get delegated to at random |

Write the **role card** before anything else, one line each: job · explicitly
NOT responsible for (and who is) · who consumes the output · trigger ("Use
when/after …"). If the card overlaps an existing agent's job, stop and extend
that agent instead.

### 2. Place it in the graph

- **Who spawns it:** main, or which agent (and at which layer)?
- **What it spawns:** only agents that exist or built-ins (`Explore`), never
  one upstream of itself.
- **Depth:** main → agent is layer 1, and the default limit is 3. Beyond that the
  `Agent` tool is withheld, so the agent at layer 3 must be able to work alone.
  The prompt must say what to do then.
- **Concurrency:** at most 20 subagents run at once per session. Fan-outs
  go in waves of ≤4, and a child spawned only to look something up gets
  `no sub-spawn` in its prompt.
- **Allowed children** go in the prompt, never as `Agent(x)` in `tools`. That
  form is ignored in subagent definitions. Record them in exactly one body
  line: ``Spawns: `a`, `b` `` or `Spawns: none`. The validator reads that
  line.

### 3. Model: by the work, not the role's prestige

| Work | Model |
|---|---|
| Judgment: plans, architecture/security verdicts, skeptics, contested trade-offs | `opus` |
| Execution and evidence: implementing, testing, tracing, compliance checks, docs | `sonnet` |
| Wide mechanical sweeps, extraction, formatting | `haiku` |

Aliases only (`opus`, `sonnet`, `haiku`, `fable`, `inherit`), never full IDs,
so routing survives model releases. Add `effort:` only with a measured reason.

### 4. Tools and write guard

- `tools` is an **allowlist**. Name exactly what the protocol uses. Omitting
  it inherits every tool, MCP included.
- Pick a guard profile from `.claude/hooks/agent-guard.mjs`:
  `readonly | specs | tests | docs | insights | impl`.
- `readonly` agents also **drop** `Edit`/`Write`/`MultiEdit`/`NotebookEdit`
  from `tools`. That guarantee holds even when hooks are skipped (untrusted
  workspace).
- A new write scope means a new profile in `agent-guard.mjs` + cases in
  `agent-guard.test.mjs` + a row in the guard table of `docs/dev-agents.md`.
  Never hand-roll a per-agent script.
- The hook entry is always the same block (copy from `templates/agent.md`):
  matcher `Edit|Write|MultiEdit|NotebookEdit|Bash`, command via
  `"$CLAUDE_PROJECT_DIR"`. Bash is matched because Bash can write files.

### 5. Skills

- **Preload** (`skills:`) what applies to *every* run, e.g. implementers get
  the seven backend/frontend skills. The whole SKILL.md is injected, so keep
  the preload under ~8k words total. Only skills in `.claude/skills/`: a
  user-global skill doesn't exist for teammates.
- **On demand:** a path → skill routing table in the prompt, with the
  instruction to load via the Skill tool before judging or writing. Keep
  `Skill` in `tools`.
- **Pass skills down:** a reviewer or planner that spawns a reviewer or
  skeptic passes its `Skills:` list in the child prompt, and the child loads
  them.

### 6. Write the prompt

Start from `templates/agent.md`. `references/prompt-anatomy.md` explains every
section and the techniques behind it. It's the part that decides whether the
agent is good. The non-negotiables:

- role with owned and **not-owned** work (plus the owner), and why it matters;
- a numbered protocol with a stop condition;
- evidence rule: `path:line`, command + output, or URL, never "should/seems";
- a fixed **Output format** with enums (verdict/status), a word cap, and
  `Insight candidates` (agents never write `INSIGHTS.md`);
- a depth-limit fallback if it can spawn;
- repo rules it could break, stated where it would break them.

Reviewers also get the mandatory **skeptic pass** (one `finding-verifier` per
finding, before returning). Planners also get the **review loop**
(`plan-critic` ∥ `architecture-reviewer` PLAN mode, ≤3 rounds). Copy both from
the existing agents verbatim. They're contracts other agents depend on.

### 7. Register it

- A row in the roster table of `docs/dev-agents.md`. Its Spawns column must match
  the `Spawns:` line.
- Its place in the chains and in the routing table (who consumes its findings).
- A new pattern (a new profile, a new loop, a new contract) needs an ADR or an
  amendment to ADR 0019.

### 8. Prove it

Run all of these. Report exact commands and results.

```bash
node .claude/skills/agent-authoring/scripts/validate-agents.mjs     # 0 errors; read the warnings
claude plugin validate .claude/agents                               # real YAML parse
node --test .claude/hooks/agent-guard.test.mjs                      # if the guard changed
node .claude/skills/agent-authoring/scripts/smoke-guard.mjs <name>  # hook fires inside Claude Code
```

Then say plainly what couldn't be verified here:

- a new agent can't be spawned in the session that created it (the roster
  loads at session start), so the user restarts the session;
- the user accepts workspace trust, or frontmatter hooks are skipped
  interactively too.

For a non-trivial agent, run a **fresh cross-review**: one `general-purpose`
`opus` subagent reads the new agent, its producers and consumers, and checks
the contracts (field names, verdict enums, depth fallbacks, guard vs.
instructions). It found 15 real defects in the first batch of agents.

### 9. Wrap up

File anything non-obvious you learned through `engineering-insights`.

## Report

```
AGENT — <name> (<new | changed>)
Role card: <job> · not: <…> · consumer: <…> · trigger: <…>
Placement: spawned by <…> at layer <n> · Spawns: <…> · deepest path <…>
Model <…> · profile <…> · tools <…> · preload <…>
Registered: roster ✓ · chains ✓ · ADR <n/a | …>
Proof: validate-agents <0 errors, n warns> · plugin validate <…> · guard tests <…> · smoke-guard <…>
Not verifiable here: <restart needed / workspace trust / …>
```
