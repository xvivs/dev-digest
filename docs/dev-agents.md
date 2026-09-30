# Dev agents

Claude Code subagents that build DevDigest itself. Definitions live in
`.claude/agents/`; the write guard is `.claude/hooks/agent-guard.mjs`. Why the
system looks like this: [ADR 0021](adr/0021-dev-agent-pipeline.md).

These are not the product's reviewer agents. Those are stored in the DB, and
their prompts are in `docs/agent-prompts/`.

## Roster

| Agent | Job | Model | Writes | Spawns |
|---|---|---|---|---|
| `brainstorm` | 2-4 real options, trade-offs, one recommendation | opus | nothing | investigator, researcher |
| `planner` | spec in `specs/` (features and agents) + review loop until clean | opus | `specs/**`, `<pkg>/specs/**` | investigator, researcher, plan-critic, architecture-reviewer |
| `plan-critic` | skeptic of a draft plan: assumptions, pre-mortem, skills conformance | opus | nothing | investigator |
| `implementer` | executes an approved spec step by step | sonnet | repo minus protected | investigator |
| `test-writer` | tests per AC and per new branch | sonnet | test paths only | investigator |
| `architecture-reviewer` | layering, boundaries, coupling, abstraction leaks, ADRs (DIFF or PLAN mode) | opus | nothing | finding-verifier, investigator |
| `security-reviewer` | untrusted source → sink tracing, severity + exploit path | opus | nothing | finding-verifier, investigator |
| `finding-verifier` | refutes or confirms ONE finding | opus | nothing | investigator |
| `dependency-auditor` | CVEs, install scripts, typosquats, lockfiles, actions, `skills-lock.json` | sonnet | nothing | finding-verifier, investigator |
| `plan-verifier` | AC compliance matrix from fresh evidence | sonnet | nothing | finding-verifier, investigator |
| `refactor-planner` | behaviour inventory, characterization tests, green steps + review loop | opus | `specs/**`, `<pkg>/specs/**` | investigator, plan-critic, architecture-reviewer |
| `refactor-implementer` | characterization tests first, then structure under green checks | sonnet | repo minus protected | investigator |
| `investigator` | finds and traces with `path:line`, no opinions | sonnet | nothing | `Explore` (haiku) |
| `researcher` | codebase + external sources (version-pinned docs, source, changelogs), cited, with `Not found` | sonnet | nothing | investigator |
| `doc-writer` | docs verified against code | sonnet | `docs/**`, `<pkg>/docs/**` | investigator |
| `insight-curator` | INSIGHTS cleanup + graduation proposals | sonnet | `INSIGHTS*.md` | investigator |

`architecture-reviewer` and `plan-critic` are not in the original request. The
chain below needs both.

## Chains

The main session orchestrates. It runs each stage, shows the human the outputs
that need approval, and commits. Agents never commit or push.

**Feature**

```
brainstorm → planner ⟲(plan-critic ∥ architecture-reviewer[PLAN]) → human approves spec
  → implementer → orchestrator commits → (architecture-reviewer[DIFF @ that commit] ∥ test-writer)
  → security-reviewer ⟲(finding-verifier × N) → plan-verifier → doc-writer
```

Add `dependency-auditor` in parallel with `security-reviewer` whenever the diff
touches `package.json`, a lockfile, `.npmrc`, `.github/workflows` or
`skills-lock.json`.

**Refactor**

```
refactor-planner ⟲(plan-critic ∥ architecture-reviewer[PLAN]) → human approves
  → refactor-implementer (phase 1 tests green → commit → phase 2 steps) → architecture-reviewer[DIFF]
```

**Maintenance:** `insight-curator` monthly, or when a file nears ~200 entries.
Commit its result on its own: `chore(insights): cleanup — …`.

Routing on findings:

| Finding | Goes to |
|---|---|
| test-writer `BUG` | implementer |
| architecture/security CRITICAL or HIGH (feature chain) | implementer in fix round, then the same reviewer again |
| architecture-reviewer CRITICAL or HIGH (refactor chain) | refactor-implementer in fix round |
| plan-verifier FAIL / INCOMPLETE | implementer, or planner if the spec was wrong |
| refactor-implementer `STOPPED (behaviour change)` | refactor-planner or a human |
| planner `APPROACH REJECTED` | brainstorm or a human |

Fix loops stop after **2 rounds** per reviewer. Anything still open then goes to the human with both reports.

## Review loops and the skeptic

- **Plans.** Each round, `planner` and `refactor-planner` spawn `plan-critic`
  and `architecture-reviewer` (PLAN mode) in parallel. Both get the same
  `Skills:` list, picked from the change sites (table below). The planner
  rewrites the spec for each finding, or rejects it with `path:line` evidence,
  and logs the resolution in the spec's `## Review log`. The loop stops at zero
  CRITICAL/MAJOR/HIGH or after 3 rounds; after round 3 the leftovers become
  BLOCKING open questions for the human.
- **Reviews.** `architecture-reviewer`, `security-reviewer`,
  `dependency-auditor` and `plan-verifier` spawn one `finding-verifier` per
  finding before they return, at every severity, in waves of up to 4. Refuted
  findings are listed but don't count toward the verdict.

| Change sites | Skills |
|---|---|
| `server/src/modules/**` | `onion-architecture`, `fastify-best-practices`, `zod` |
| `server/src/platform/**` | `onion-architecture`, `fastify-best-practices` |
| `server/src/adapters/**` | `onion-architecture`, `security` |
| `server/src/db/**` | `drizzle-orm-patterns`, `postgresql-table-design` |
| `*/src/vendor/shared/**` | `zod`, `typescript-expert` |
| `client/src/**` | `frontend-architecture`, `react-best-practices`, `next-best-practices` |
| client tests | `react-testing-library` |
| `reviewer-core/src/**` | `typescript-expert` + core purity P1-P7; prompt, grounding or model output → `security` too |
| untrusted input, secrets, rendering model output | `security` |
| a diagram in the spec | `mermaid-diagram` |

`planner` loads the skills for its change sites itself before writing the
spec, not only for the reviewers, so the spec already follows them.

Preloaded through the `skills:` frontmatter: both implementers get all seven
backend and frontend skills; `planner` gets `onion-architecture`,
`frontend-architecture` and `security`; `architecture-reviewer` and
`refactor-planner` get `onion-architecture` and `frontend-architecture`;
`security-reviewer` gets
`security`; `test-writer` gets `react-testing-library`; `insight-curator` gets
`engineering-insights`. Everything else is loaded on demand with the Skill
tool.

## Nesting depth

By default Claude Code lets subagents nest three layers below the main
conversation (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, since v2.1.219). At the
limit the `Agent` tool is withheld, and every agent prompt says what to do then:
the work itself, noted in the report. The deepest planned path fits exactly:

```
main → planner (1) → architecture-reviewer (2) → finding-verifier (3)
```

Two things the docs make easy to miss:

- `Agent(name, …)` allowlists in a subagent's `tools` are **ignored**. They
  apply only to `claude --agent`. Listing `Agent` enables spawning any type, so
  the allowed children are named in each prompt and summarised in the roster
  above. The graph is acyclic: nothing spawns an agent upstream of itself.
- At most 20 subagents run at once per session
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). The worst stage is security-reviewer ∥
  dependency-auditor: 2 reviewers + 2×4 verifiers + their investigators = 18.
  So skeptic passes run in waves of 4, and investigators spawned by verifiers or
  the curator get `no sub-spawn`. On `Concurrent subagent limit reached` an
  agent verifies that item itself instead of retrying.

## Write guard

Each agent's frontmatter runs `agent-guard.mjs <profile>` as a `PreToolUse`
hook on `Edit|Write|MultiEdit|NotebookEdit|Bash`:

| Profile | Agents | File writes allowed |
|---|---|---|
| `readonly` | reviewers, verifiers, brainstorm, investigator | none (temp dirs only) |
| `specs` | planner, refactor-planner | `specs/**`, `<pkg>/specs/**` (not `e2e/specs`) |
| `tests` | test-writer | `server/test/**`, `server/src/**/*.test.ts`, `client/src/**/*.test.ts(x)`, `client/src/test/**`, `reviewer-core/test/**`, `reviewer-core/src/**/*.test.ts`, `e2e/specs/*.flow.json`, `fixtures/**` |
| `docs` | doc-writer | `docs/**`, `<pkg>/docs/**` |
| `insights` | insight-curator | `INSIGHTS.md`, `INSIGHTS-<Domain>.md` |
| `impl` | implementer, refactor-implementer | anything not protected |

Protected for every profile: `.git/`, `.claude/`, `.cursor/`, `.devdigest/`,
`node_modules/`, `server/src/db/migrations/`, the arch baseline, lockfiles,
`AGENTS.md`/`CLAUDE.md`, and `INSIGHTS*.md` (except the `insights` profile). All
profiles block `git` commands that commit, push, move HEAD or touch the shared
stash; `--no-verify`; `docker compose down -v`; `npx`/`dlx`; `sed -i`;
`bash -c` wrappers; and piping a download into a shell. Only `impl` may install
dependencies or run `db:*` scripts. Symlinks are resolved, so `.cursor/skills`
can't be used to reach `.claude/skills`.

The guard is defense in depth, not a sandbox. It does not parse interpreter
one-liners such as `node -e "fs.writeFileSync(…)"`. Two operational caveats:

- Frontmatter hooks run only after the **workspace trust** dialog has been
  accepted for this folder. Without it the agents still run, unguarded; the
  debug log says so.
- The settings-level pr-self-review gate (`.claude/settings.json`) still
  applies inside subagents.

Tests: `node --test .claude/hooks/agent-guard.test.mjs`.

## Changing an agent

Use the `agent-authoring` skill (`.claude/skills/agent-authoring/`). It covers the decision, placement, model/tools/guard/skills choice, the prompt template, registration and proof (`validate-agents.mjs`, `smoke-guard.mjs`). Summary of its rules:


- Keep the shape: role with owned and not-owned work, why it matters,
  protocol, rules, fixed output format, word cap.
- Every agent ends with a fixed report and never with "done". Durable learnings
  go in `Insight candidates`; the orchestrator files them through
  `engineering-insights`.
- Pick the model by the work, not the role's prestige: judgment calls (plans,
  architecture and security verdicts, skeptics) run on `opus`; execution and
  evidence gathering on `sonnet`; wide mechanical sweeps on `haiku`. Use
  aliases, never full model IDs. The table above is the routing source of
  truth, so update it with the frontmatter.
- A new write scope means a new profile in `agent-guard.mjs` and a test case.
