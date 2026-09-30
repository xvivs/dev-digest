# Dev agents: map

A map of the subagents that build DevDigest. It says who does what, with which
permissions, and what goes in and out. It does not repeat the prompts: the
agent files are the behaviour, and this page points at them.

- Chains, routing on findings, nesting limits, guard profiles:
  [`docs/dev-agents.md`](../../docs/dev-agents.md). That roster is the source of
  truth for model and `Spawns`, and `validate-agents.mjs` checks it.
- Why the system looks like this: [ADR 0021](../../docs/adr/0021-dev-agent-pipeline.md).
- Adding or changing an agent: the `agent-authoring` skill
  (`.claude/skills/agent-authoring/`).

This file has no frontmatter on purpose: Claude Code treats a `.md` here without
`name` as documentation, and the validator skips it. Nothing checks it either,
so update it in the same edit as the agent.

## Agents

Every agent has an allowlisted `tools` field and runs
`.claude/hooks/agent-guard.mjs <profile>` as a `PreToolUse` hook on
`Edit|Write|MultiEdit|NotebookEdit|Bash|Agent`. `readonly` agents also carry
no `Edit`/`Write`. The Spawns column is enforced: the guard denies an `Agent`
call for any type not in the caller's `Spawns:` line. Tool abbreviations: R Read, G Grep,
Gl Glob, B Bash, A Agent, S Skill, W Write, E Edit, WS WebSearch, WF WebFetch.

| Agent | Responsibility | Model | Tools | Writes (profile) | Preloaded skills | Input | Output | Spawns |
|---|---|---|---|---|---|---|---|---|
| [`brainstorm`](brainstorm.md) | 2-4 structurally different options, one recommendation | opus | R G Gl B A S WS WF | nothing (`readonly`) | — | the problem from main | Options + `## Recommendation` + hand-off to planner, ≤700 words | investigator, researcher |
| [`planner`](planner.md) | executable spec + review loop until clean or 3 rounds | opus | R G Gl B A S W E | `specs/**`, `<pkg>/specs/**` (`specs`) | onion-architecture, frontend-architecture, security | approach (brainstorm hand-off or delegation) | spec file + `Status: READY \| NEEDS APPROVAL \| APPROACH REJECTED`, ≤350 words | investigator, researcher, plan-critic, architecture-reviewer |
| [`plan-critic`](plan-critic.md) | skeptic of a draft plan: assumptions, pre-mortem, skills conformance | opus | R G Gl B A S | nothing (`readonly`) | — | spec path, round, `Skills:` list, previous findings | `Verdict: REJECT \| REVISE \| ACCEPT`, ≤700 words | investigator |
| [`implementer`](implementer.md) | executes an approved spec with the smallest diff | sonnet | R G Gl B A S W E | repo minus protected (`impl`) | the 7 backend + frontend skills | approved spec, or findings in a fix round | `Status: DONE \| PARTIAL \| BLOCKED` + steps, fresh verification, deviations, ≤500 words | investigator |
| [`test-writer`](test-writer.md) | one test per AC + new edge/error paths | sonnet | R G Gl B A S W E | test paths only (`tests`) | react-testing-library | spec + diff + implementer hand-off | `Status: DONE \| BUGS FOUND \| PARTIAL`, ≤450 words | investigator |
| [`architecture-reviewer`](architecture-reviewer.md) | layering, boundaries, ADRs; DIFF or PLAN mode | opus | R G Gl B A S | nothing (`readonly`) | onion-architecture, frontend-architecture | a commit (DIFF) or a spec (PLAN) + `Skills:` | `Verdict: APPROVE \| REQUEST_CHANGES`, ≤25 findings | finding-verifier, investigator |
| [`security-reviewer`](security-reviewer.md) | untrusted source → sink tracing with exploit paths | opus | R G Gl B A S | nothing (`readonly`) | security | a diff | `Verdict: BLOCK \| PASS_WITH_WARNINGS \| PASS`, ≤15 findings | finding-verifier, investigator |
| [`dependency-auditor`](dependency-auditor.md) | CVEs, install scripts, typosquats, lockfiles, actions, skills-lock | sonnet | R G Gl B A WF WS | nothing (`readonly`) | — | a diff touching manifests, lockfiles, workflows | `Verdict: BLOCK \| REVIEW \| PASS`, ≤500 words | finding-verifier, investigator |
| [`finding-verifier`](finding-verifier.md) | tries to refute exactly one finding | opus | R G Gl B A S WF | nothing (`readonly`), maxTurns 40 | — | one finding block | `CONFIRMED \| REFUTED \| UNCERTAIN` + corrected severity, ≤300 words | investigator |
| [`plan-verifier`](plan-verifier.md) | AC compliance matrix from fresh evidence | sonnet | R G Gl B A S | nothing (`readonly`) | — | spec + outputs of earlier stages | `Verdict: PASS \| FAIL \| INCOMPLETE`, ≤600 words | finding-verifier, investigator |
| [`refactor-planner`](refactor-planner.md) | behaviour inventory, characterization tests, green steps + review loop | opus | R G Gl B A S W E | `specs/**`, `<pkg>/specs/**` (`specs`) | onion-architecture, frontend-architecture | the refactor goal | plan file + `Status: READY \| NEEDS APPROVAL \| APPROACH REJECTED`, ≤350 words | investigator, plan-critic, architecture-reviewer |
| [`refactor-implementer`](refactor-implementer.md) | characterization tests first, then structure under green checks | sonnet | R G Gl B A S W E | repo minus protected (`impl`) | the 7 backend + frontend skills | approved refactor plan | `Status: DONE \| PARTIAL \| BLOCKED \| STOPPED (behaviour change)`, ≤500 words | investigator |
| [`investigator`](investigator.md) | finds and traces code with `path:line`, no opinions | sonnet | R G Gl B A | nothing (`readonly`), maxTurns 60 | — | one concrete question | `## Answer` + evidence chain + unknowns, ≤600 words | Explore (haiku) |
| [`researcher`](researcher.md) | codebase + external sources, cited, with `Not found` | sonnet | R G Gl B A WS WF | nothing (`readonly`), maxTurns 60 | — | one question | `## Answer` + findings + conflicts + not found, ≤600 words | investigator |
| [`doc-writer`](doc-writer.md) | docs verified against code | sonnet | R G Gl B A S W E | `docs/**`, `<pkg>/docs/**` (`docs`) | — | a shipped change (after plan-verifier) | docs changed + proposals outside `docs/`, ≤400 words | investigator |
| [`insight-curator`](insight-curator.md) | INSIGHTS cleanup + graduation proposals | sonnet | R G Gl B A S W E | `INSIGHTS*.md` (`insights`) | engineering-insights | the INSIGHTS files | removed/merged list + graduation proposals, ≤600 words | investigator |

Every report ends with `Insight candidates`. No agent commits, pushes or writes
`INSIGHTS.md` (except `insight-curator`); the main session commits and files
insights through `engineering-insights`.

## Where the rules come from

Each row gives a practice, the source it rests on, the concrete rule, and where
the rule lives. Line numbers are as of 2026-09-30. External quotes were fetched
on that date; "principle" means the source backs the idea, while the number or
exact wording is this repo's own choice (ADR 0021).

Short names: **BP** [Claude Code best practices](https://code.claude.com/docs/en/best-practices) ·
**SA** [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) ·
**HK** [Claude Code hooks](https://code.claude.com/docs/en/hooks) ·
**PB** [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) ·
**BEA** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) ·
**MAR** [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) ·
**GCL** [Google eng-practices: small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html).

### planner

| Practice | Source | Rule | Where |
|---|---|---|---|
| Plan before code | BP, "Explore first, then plan, then code" | the plan lands before the code; an ambiguity left in the spec is a shipped defect | `planner.md:25` |
| Read existing patterns first | BP, "Provide specific context" | load AGENTS.md, INSIGHTS, ADRs and an existing spec as house style | `planner.md:29` |
| Apply the stack's rules while writing, not only in review | SA, "Preload skills into subagents" | three skills preloaded; the rest loaded per change site before naming one | `planner.md:7-10`, `:30` |
| No claims about unopened code | PB: "Never speculate about code you have not opened." | open every change site before naming it; delegate lookups to investigator | `planner.md:31` |
| Testable requirements | EARS: Mavin et al., RE'09 ([paper](https://research.manchester.ac.uk/en/publications/easy-approach-to-requirements-syntax-ears/), [templates](https://alistairmavin.com/ears/)) | acceptance criteria as "When <trigger>, the <system> shall <response>" | `planner.md:39` |
| Every step has a check | BP, "Give Claude a way to verify its work" | each step carries an exact verify command and expected result | `planner.md:43`, `:102` |
| Small changes | GCL (principle; 3-12 is ours) | 3-12 steps, more means split the feature | `planner.md:103` |
| Fresh-context adversarial review | BP, "Add an adversarial review step" | mandatory loop: plan-critic ∥ architecture-reviewer (PLAN) each round | `planner.md:53`, `:55-76` |
| Bounded iteration | BEA, stopping conditions (principle; 3 rounds is ours) | stop at zero CRITICAL/MAJOR/HIGH or after 3 rounds, leftovers become BLOCKING | `planner.md:85` |
| Reject findings only with evidence | BP, adversarial-review callout (principle); ADR 0021 | reject needs `path:line` or `skill:rule`, "disagree" is not a reason | `planner.md:78` |
| Scoped writes enforced, not requested | HK; BP, "Set up hooks" | `specs` guard profile; the prompt rule is backed by the hook | `planner.md:11-17`, `:109` |
| Clear delegation contract | MAR: each subagent needs "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries" | fixed output skeleton with a status enum, 350-word cap | `planner.md:116-141` |
| Untrusted input is named in the plan | [OWASP Top 10:2025](https://top10.owasp.org/2025/), Injection (category only) | a `## Untrusted inputs` section in every spec | `planner.md:48` |

### implementer

| Practice | Source | Rule | Where |
|---|---|---|---|
| The spec is the contract | BP, "Let Claude interview you" (principle) | a BLOCKING open question or a step that needs guessing → `Status: BLOCKED` | `implementer.md:33` |
| Persistent project context | BP, "Write an effective CLAUDE.md" | read the touched packages' AGENTS.md and INSIGHTS, name applied entries | `implementer.md:34` |
| Binding stack rules | SA, "Preload skills into subagents" | 7 backend/frontend skills preloaded and binding | `implementer.md:7-14`, `:35` |
| Smallest diff | PB: "Don't add features, refactor code, or make "improvements" beyond what was asked"; GCL | the change the step describes and nothing else | `implementer.md:29`, `:40` |
| Verify every step | BP, "Give Claude a way to verify its work" | run the step's verify command before the next step | `implementer.md:41` |
| Bounded retries | BP, "Avoid common failure patterns" (principle; 3 is ours) | 3 failed attempts → `Status: PARTIAL` with the failing output | `implementer.md:41` |
| Tests are not gamed | PB: "Do not hard-code values or create solutions that only work for specific test inputs." | a red test from test-writer is the spec of the fix; never edit the test | `implementer.md:49` |
| No bypassing safety | PB, "Balancing autonomy and safety" (`--no-verify`, `reset --hard`, force push) | never commit, push, stash, reset or `--no-verify` | `implementer.md:61` |
| Protected paths blocked by a hook | BP, "Set up hooks" | `impl` guard profile blocks `.claude/`, migrations, lockfiles, AGENTS.md | `implementer.md:15-21`, `:61` |
| Supply chain goes to review | OWASP Top 10:2025, Software Supply Chain Failures (category only) | add a dependency only when the spec says so, flag it for dependency-auditor | `implementer.md:60` |
| Evidence, not assertion | BP: "Have Claude show evidence rather than asserting success" | fresh final verification with command output | `implementer.md:67`, `:87` |
| Nobody grades their own work | BP, "Run multiple sessions" | hand off to architecture-reviewer ∥ test-writer instead of self-review | `implementer.md:27`, `:94` |
| Don't over-delegate | PB, "Subagent orchestration" | spawn only investigator, only for questions two greps can't answer | `implementer.md:65` |

### Across agents

| Practice | Source | Rule | Where |
|---|---|---|---|
| One agent, one job | SA: "each subagent should excel at one specific task" | owned / not-owned work, each exclusion names its owner | every agent's opening lines; `agent-authoring` step 1 |
| Fixed pipeline over dynamic routing | BEA: "Workflows offer predictability for well-defined tasks" | feature and refactor chains orchestrated by main | `docs/dev-agents.md` Chains; ADR 0021 |
| Least-privilege tools | SA, "Available tools" (`tools` allowlist) | every agent lists its tools; `readonly` drops Edit/Write | frontmatter `tools:` |
| Write guard as an agent-scoped hook | SA, "Conditional rules with hooks"; HK | `agent-guard.mjs <profile>` on `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash` | frontmatter `hooks:`; `.claude/hooks/agent-guard.mjs` |
| Delegation allowlist enforced, not requested | HK, PreToolUse input for `Agent` (`subagent_type`, `prompt`); BP, "Set up hooks" | the caller's `Spawns:` line is the allowlist; "no sub-spawn" callers must pass it on | `agent-guard.mjs` `checkAgent`; `Spawns:` lines |
| Model by the work | SA, "Choose a model" (mechanism; mapping is ours) | judgment → opus, execution → sonnet, sweeps → haiku | frontmatter `model:`; `agent-authoring` step 3 |
| Adversarial verification per finding | BP: a fresh model "try to refute the result, so the agent doing the work isn't the one grading it" | one finding-verifier per finding before a reviewer returns | `finding-verifier.md:22`, `:42`; the four reviewers |
| Pre-mortem | Klein, "Performing a Project Premortem", HBR, Sept 2007 ([link](https://hbr.org/2007/09/performing-a-project-premortem); paywalled, abstract only) | "it was implemented exactly as written and failed" → causes | `plan-critic.md:41`, `brainstorm.md:34` |
| Characterization tests before refactoring | Feathers, *Working Effectively with Legacy Code* (bibliographic, not fetched) | pin current behaviour, then restructure | `refactor-planner.md:35`, `:42`; `refactor-implementer.md:37-52` |
| Refactoring keeps behaviour | [Fowler, Definition of Refactoring](https://martinfowler.com/bliki/DefinitionOfRefactoring.html): "without changing its observable behavior" | stop on any behaviour change: `STOPPED (behaviour change)` | `refactor-implementer.md` Status enum |
| Output contract + word caps | MAR (delegation contract); BP: "The context window is the most important resource to manage." (caps are ours) | fixed skeleton, enum verdicts, `Cap:` line | every `## Output format` |
| Prompt anatomy | [oh-my-claudecode agents](https://github.com/Yeachan-Heo/oh-my-claudecode) (per `prompt-anatomy.md:3-5`, not re-fetched) | identity + stance, owned/not owned, why it matters, protocol, contracts | `.claude/skills/agent-authoring/references/prompt-anatomy.md` |
| Cost of multi-agent | MAR: "Multi-agent systems use about 15× more tokens than chats" | nesting depth 3, waves ≤4, `no sub-spawn` for lookups | `docs/dev-agents.md` Nesting depth; ADR 0021 |

### Rules with no external source

These are this repo's own decisions. Don't cite an outside source for them
unless you find one.

- Record a baseline before changing anything (`implementer.md:36`).
- The guard fails closed on an unknown profile or unparsable payload (`agent-guard.mjs:23`, `:94`).
- Don't invent requirements; assumptions go into Decisions (`planner.md:110`).
- Onion/DI, `arch:check`, `SecretsProvider`, vendored-shared twins
  (`implementer.md:54`, `:58`): AGENTS.md "Cross-package rules".
- The numbers: 3 review rounds, 3 retries, 3-12 steps, word caps (ADR 0021).
