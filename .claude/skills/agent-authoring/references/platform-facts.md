# Platform facts (verified)

Checked against `code.claude.com/docs/en/sub-agents.md` and `hooks.md` with
Claude Code **2.1.285** (2026-09-30), and by live runs where marked 🧪. The
docs change between minor versions. The nesting default alone moved 5 → 1 → 3
across 2.1.172-2.1.219. Before relying on a fact from here after an upgrade,
re-check it:

```bash
curl -sL https://code.claude.com/docs/en/sub-agents.md | grep -n -i '<term>'
claude --version
```

## Frontmatter fields

Only `name` and `description` are required. Unknown fields are **ignored
without an error**; the validator catches them.

| Field | Values / notes |
|---|---|
| `name` | kebab-case, unique across the tree, no `:` (reserved for plugins), no leading `-`. Keep it equal to the filename |
| `description` | When to delegate. The main session routes on this text, so a missing trigger means the agent is never picked. It's a YAML plain scalar: `: ` inside it breaks parsing unless it's in backticks or quoted |
| `tools` | Allowlist, comma string or YAML list. Omitted = every tool, MCP included. If nothing resolves, the agent refuses to launch |
| `disallowedTools` | Denylist, applied before `tools`. A specifier such as `Bash(git push *)` still removes the **whole** tool |
| `model` | `sonnet` `opus` `haiku` `fable` `inherit` or a full ID. Resolution order: per-call `model` param → frontmatter → `CLAUDE_CODE_SUBAGENT_MODEL` → main model |
| `permissionMode` | `default` `acceptEdits` `auto` `dontAsk` `bypassPermissions` `plan` `manual` |
| `maxTurns` | At the limit the output comes back marked partial and can be resumed |
| `skills` | Preloaded; the **full** SKILL.md is injected. Unlisted skills stay reachable via the Skill tool |
| `mcpServers` | Names of configured servers or inline configs |
| `hooks` | Lifecycle hooks active only while this agent runs (see below) |
| `memory` | `user` (`~/.claude/agent-memory/<name>/`), `project` (`.claude/agent-memory/<name>/`, in VCS), `local` (`.claude/agent-memory-local/<name>/`) |
| `background` | `true` forces background |
| `omitClaudeMd` | `true` skips CLAUDE.md/AGENTS.md injection (v2.1.271+). Our agents need AGENTS.md, so don't use it |
| `effort` | `low` `medium` `high` `xhigh` `max`; overrides the session effort |
| `isolation` | `worktree` only. It branches from the **default branch**, not the caller's HEAD, so it's wrong for agents that continue a feature branch |
| `color` | `red` `blue` `green` `yellow` `purple` `orange` `pink` `cyan` |
| `initialPrompt` | Only when run as main session via `--agent` |
| `experimental.cacheTtl` | `5m` / `1h` |

A `.md` in `.claude/agents/` with **no `name`** is treated as documentation,
so a README there is safe. A file with bad YAML is skipped silently (debug log
only).

## Nesting and concurrency

- Default depth: **3 layers below main** (since v2.1.219). Set it with
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; `1` disables nesting. At the limit
  the `Agent` tool is withheld (a fork keeps it but gets an error).
- `Agent` in `tools` enables spawning **any** type. `Agent(a, b)` allowlists
  are **ignored** in subagent definitions and work only for `claude --agent`
  main threads. To block a type globally, use `permissions.deny: ["Agent(x)"]`.
- Interactive: a subagent that launches background children waits for them,
  and only the top-level summary reaches main. In `-p` / SDK the launcher
  doesn't wait.
- At most **20** subagents run concurrently per session
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). Past that, spawn fails with
  `Concurrent subagent limit reached` and tells the model not to retry.
- Background subagents keep only a fixed set of built-in tools (Read, Grep,
  Glob, LSP, Bash, Edit, Write, WebFetch, WebSearch, Skill, SendMessage, …),
  plus `Agent` per the depth rule.

## Hooks in agent frontmatter

- `PreToolUse` input on stdin: `tool_name`, `tool_input` (`file_path`,
  `command`, `notebook_path`), `cwd`, `agent_type`, `agent_id`. For the
  `Agent` tool, `tool_input` carries `subagent_type` and `prompt`
  (`hooks.md`, "Agent"), so a frontmatter hook can deny a child type.
  🧪 `smoke-guard.mjs` shows it: with `Agent` in the matcher the probe's spawn
  is denied, without it the same spawn goes through.
- 🧪 A `-p` model told to run several guarded steps stops at the first block
  unless the prompt says the steps are independent. A smoke probe that doesn't
  say so reports later steps as "blocked" without ever trying them.
- Block with exit 0 plus
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`.
  The reason is shown to the agent. Exit 0 with no output means no opinion.
- `Stop` in frontmatter becomes `SubagentStop`.
- Settings-level hooks (`.claude/settings.json`) **also** fire inside
  subagents. The pr-self-review gate applies to agents too.
- 🧪 **Project-agent frontmatter hooks need workspace trust.** They are
  skipped in `claude -p` (never trusted) and in an untrusted interactive
  folder. The agent still runs, unguarded. Definitions passed with
  `--agents '<json>'` run their hooks without trust, which is how
  `smoke-guard.mjs` tests the real hook.

## Loading

- 🧪 The roster loads at **session start**. An agent file written mid-session
  gives `Agent type '<name>' not found` until the session restarts.
- 🧪 `claude -p --agent <name>` smoke-tests loading (name, tools), but not
  hooks.
- `claude plugin validate .claude/agents` parses every file's YAML. It doesn't
  flag a missing `name`.
- Duplicate `name`s in one directory: one of them wins, in filesystem order.
