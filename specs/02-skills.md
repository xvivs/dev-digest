# Spec: Skills

**Spec ID:** SPEC-02 · **Status:** draft · **Lesson:** L02

**Affected modules:** `server` (new `skills` module · agents · reviews/run-executor · db · seed) ·
`client` (new `/skills` route · agents editor · RunTraceDrawer · vendor/ui Markdown · nav) ·
`reviewer-core` (prompt) · vendored shared contracts ×2 · `.claude/skills/pr-self-review`

## Problem & Motivation

An agent today is one `system_prompt` string (`server/src/db/schema/agents.ts`). If two agents
need the same rubric, you paste it twice and the copies drift. If you want to test whether a
rule helps, you edit the prompt, run, and edit it back. The prompt keeps no history of which
rule was active on which run.

Most of the plumbing already exists and nothing connects it:

- `skills`, `skill_versions` and `agent_skills` exist since migration `0000_init.sql`.
- `ReviewInput.skills?: string[]` exists (`reviewer-core/src/review/run.ts:56`) and
  `assemblePrompt` renders a `## Skills / rules` block (`reviewer-core/src/prompt.ts:88-109`).
- The run trace drawer already renders a Skills block when `prompt.skills != null`
  (`TraceBody.tsx:80-81`).
- `run-executor.ts:187-212` never passes `skills`, so that block is always empty.

The part that needs deciding is trust. A skill is text that someone else can write, and it
lands in the agent's prompt with the authority of an instruction. An imported skill is
somebody else's instructions running inside your reviewer. ADR 0012 records the model this
spec implements.

## Goals / Non-goals

### Goals

1. Skills live in the database, scoped to a workspace. The database is the source of truth.
2. You can create, edit, enable/disable and delete a skill from a `/skills` page.
3. You can attach skills to an agent, enable them per agent, and set their order. The order
   is the order of blocks in the prompt.
4. You can import a skill from a `.md` file or a `.zip` archive, see a preview, and save it
   only after confirming. Executable parts of an archive are never run.
5. Every run trace shows which skills went into the prompt, at which version, and roughly
   how many tokens they added.
6. Two new agents, Test Quality Reviewer and API Contract Reviewer, ship with attached
   skills. At least one of their skills enters through the import path.
7. A control experiment shows each new agent missing a defect without its skills and
   flagging it with them.

### Non-goals

| Excluded | Why |
|---|---|
| Evals, Stats, Versions tabs with real content | Later lessons own evals and metrics. The tabs render as placeholders so the layout matches the mockup |
| Pull frequency and accept rate on skill cards | No data source exists yet |
| Import from URL, community catalogue | A server-side fetch adds an SSRF surface. `SkillSource.imported_url` and `community` stay in the enum, unused |
| `skills.evidence_files` | Belongs to convention extraction (later lesson) |
| Exact tokenizer | See D4 |
| Restoring an old skill version | `skill_versions` rows are written; reading them back belongs to the Versions tab |
| Running anything from an imported archive | Out of scope forever, see Untrusted inputs |

### Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `agent_skills` gains `enabled`. A skill reaches the prompt when `skill.enabled && link.enabled && !skill.needs_vetting` | A per-agent toggle keeps the link and its position; unlinking would lose the order |
| D2 | Archives are parsed in the browser (`fflate`, streaming). The server receives JSON and re-validates it | No multipart, no server-side unzip, no change to the 1 MB `bodyLimit` |
| D3 | Skill detail has five tabs; Evals, Stats and Versions are placeholders | Matches the mockup without inventing data |
| D4 | Token counts are estimates: `ceil(chars / 4)`, shown with `≈` | Pure, dependency-free, same formula on client and core. It undercounts Cyrillic and CJK by up to 2× |
| D5 | Vetted skills go into the **system** message, in a `<skills>` block after the agent prompt and **before** `INJECTION_GUARD`. Imported skills start disabled and unvetted | See ADR 0012 |
| D6 | Reorder uses native HTML5 drag plus ↑/↓ buttons | No new dependency; buttons cover keyboard users and jsdom tests |
| D7 | The agent Skills tab autosaves (400 ms debounce) and says so | Toggling a checkbox and then hunting for a Save button is friction; the Config tab keeps its explicit Save |
| D8 | `PUT /skills/:id` accepts a partial body | Follows the existing `UpdateAgentBody` convention (`agents/routes.ts:46-57`); not a new bug |
| D9 | Delete is a hard delete; links cascade | Old traces keep a snapshot `{id, name, version, sha256}` and render "deleted skill" |

## User stories

- As an engineer, I write a rubric once as a skill and attach it to three agents, so a fix
  to the rubric reaches all three.
- As an engineer, I switch a skill off for one agent and see the next run's trace without
  that block, so I can measure what the skill does.
- As an engineer, I import a skill someone shared as a zip, read exactly what the model
  will receive, and decide whether to trust it before it can affect any review.
- As an engineer reading a trace, I see which skills went in, at what version, and what
  they cost in tokens.

## Acceptance criteria (EARS)

### Skills page (`/skills`)

- **AC-1** When you open `/skills`, the page shall list the workspace's skills as cards
  showing name, type badge, source, a two-line description, an enabled toggle and
  `N agents`.
- **AC-2** When you type in the search field, the list shall filter by name and description.
- **AC-3** When you click a card, the right pane shall show the skill at
  `/skills/[id]?tab=config`, with tabs Config · Preview · Evals · Stats · Versions.
- **AC-4** The Add Skill button shall open a menu with *Create* and *Import from file*.
- **AC-5** If a skill has `needs_vetting`, then its card shall show a "needs vetting"
  badge, and switching it on shall open a *Review & trust* dialog instead of enabling it.

### Skill editor

- **AC-6** The Config tab shall offer Name (required), Description, Type and Body
  (required, markdown, monospace). The Description field shall carry the hint:
  "The description is the skill's interface. Write it as a directive: *Use when… Flags…*".
- **AC-7** While the body has unsaved changes, the editor shall show an `unsaved` badge
  and an `≈N tokens` counter.
- **AC-8** If the form is dirty and you switch to another skill or route, then the editor
  shall ask for confirmation. Closing the tab shall trigger `beforeunload`.
- **AC-9** When you save a changed body, the server shall increment `version` and write a
  `skill_versions` row in the same transaction.
- **AC-10** The Preview tab shall render the body as markdown under the caption "Rendered as
  the reviewing agent receives it", with a *Source* toggle that shows raw text with
  invisible characters marked.
- **AC-11** The Evals, Stats and Versions tabs shall render an empty state naming the
  lesson that fills them. *Run on evals* shall be disabled with a tooltip.

### Agent Skills tab

- **AC-12** When you open an agent, a *Skills* tab shall appear next to *Config*.
- **AC-13** The tab shall list every workspace skill: linked skills first in `order`, then
  the rest by name. Each row shows a drag handle, a checkbox, the name and the type badge.
- **AC-14** The header shall show `{enabled} of {total} enabled` and a filter field.
- **AC-15** When you tick, untick, drag or use ↑/↓, the client shall save the full list
  within 400 ms of the last change, in one request.
- **AC-16** If you switch agents or leave the page with a save pending, then the client
  shall send it before unmounting.
- **AC-17** If a skill is disabled globally or unvetted, then its row shall render muted
  with the reason, and the skill shall not reach the prompt even when ticked.
- **AC-18** If the enabled skills exceed the budget (24 KB of body text), then the server
  shall reject the save with 422 and the tab shall show the reason.
- **AC-19** The agent card shall show the number of enabled skills.

### Import

- **AC-20** When you pick a `.md` file, the client shall read its frontmatter (`name`,
  `description`, optional `type`) and body. Without frontmatter, name comes from the file
  name and description is left empty and required.
- **AC-21** When you pick a `.zip`, the client shall locate `SKILL.md` at the root or one
  level down, and list every other entry as "skipped, not executed". Entries under
  `scripts/` or with executable extensions (`.sh .js .ts .py .rb .ps1 .bat .exe`) shall be
  flagged.
- **AC-22** The preview shall show rendered and source views, editable fields, and a
  trust banner: "This is someone else's instructions. Once enabled, it goes into your
  agent's prompt."
- **AC-23** When you confirm, the client shall `POST /skills` with `source: 'imported'`.
  The server shall store it with `enabled = false` and `needs_vetting = true`, whatever the
  request says.
- **AC-24** If you cancel, then nothing shall be stored.

### Runtime and trace

- **AC-25** When a run starts, the server shall resolve each agent's effective skills
  (D1) in `order` and pass their bodies to the prompt builder.
- **AC-26** The prompt builder shall place them in the system message per D5, each under
  `### <name>`, with `<untrusted` and `</untrusted>` escaped inside bodies.
- **AC-27** The trace shall record `skills_tokens` and `skills_used: {id, name, version,
  sha256, tokens}[]`. In map-reduce mode the trace shall show the per-chunk multiplier.
- **AC-28** When no skill is effective, the trace shall carry no Skills block.
- **AC-29** When a trace predates this feature, the drawer shall render it and parsing
  shall not fail.

### Persistence

- **AC-30** Skill names shall be unique per workspace. A duplicate returns 409.
- **AC-31** `PUT /agents/:id/skills` shall reject any `skill_id` from another workspace
  with 404, and shall replace the links atomically.
- **AC-32** Deleting a skill shall remove its links and leave old traces readable.

### pr-self-review

- **AC-33** `.claude/skills/pr-self-review/SKILL.md` shall set
  `disable-model-invocation: true`, and the gate hook's block message shall tell the
  person to run `/pr-self-review` themselves.

## Edge cases

| Situation | Expected |
|---|---|
| Skill linked but disabled globally | Muted row, not in prompt |
| Imported skill ticked on an agent before vetting | Link stored, skill not in prompt, row explains why |
| Imported skill vetted, then body edited | `needs_vetting` resets to true; skill leaves the prompt until re-vetted |
| Body contains `</untrusted>` | Escaped in the prompt; trace shows the escaped text |
| Body contains U+E0000–E007F, bidi overrides or zero-width chars | 422 from the server; Source view marks them in the import preview |
| Body contains `<!-- … -->` | Accepted; Source view shows a warning, since Rendered hides comments |
| Body contains `![](https://…)` | Rendered as a link in skill previews, never loaded |
| Zip with no `SKILL.md` | Import error, nothing stored |
| Zip whose declared sizes lie | Streaming counter aborts at 5 MB inflated |
| Zip entry path with `..` or leading `/` | Entry ignored, listed as rejected |
| Two actions within one debounce window | One `PUT` with the final list |
| A slow `PUT` returns after a newer one | Stale response ignored |
| Skill deleted while a run is in flight | The run keeps the body it resolved at start |
| Trace referencing a deleted skill | Name and version from the snapshot, marked "deleted" |
| Agent with zero skills | Prompt identical to today's |

## Non-functional

- The agents list reads `skill_count` from the list query. No per-card request.
- `agent_skills` gains an index on `skill_id`. The PK `(agent_id, skill_id)` does not
  cover lookups by skill, which `agent_count` and the delete cascade both need.
- Skill resolution happens once per run batch, next to the diff load.
- Enabled-skills budget per agent: 24 KB of body text (≈6k tokens). In map-reduce the
  skills repeat per file chunk, so cost scales with `files × skills`.
- `fflate` loads through dynamic import on the import drawer only.

## Inputs (provenance)

| Input | Provenance |
|---|---|
| `skills`, `skill_versions`, `agent_skills` | `[reused:` `server/src/db/schema/skills.ts`, `agents.ts:51-63` `]` extended by migration |
| `Skill`, `AgentSkillLink`, `SkillSource` contracts | `[reused:` `vendor/shared/contracts/knowledge.ts:114-199` `]` extended in both copies |
| Prompt skills slot | `[reused:` `reviewer-core/src/prompt.ts` `]` moved to the system message |
| Trace Skills block | `[reused:` `TraceBody.tsx:80-81` `]` |
| Tab routing | `[reused:` `resolveTab/withTab` from `app/agents/[id]` `]` |
| i18n | `[reused:` `messages/en/skills.json`, `agents.json` `]` rewritten where the copy contradicts ADR 0012 |
| Diff for seeded PRs | `[reused:` `diff-loader.ts` fallback to `pr_files.patch` `]` |
| Zip parsing | `[new:` `fflate` in client `]` |
| Token estimate | `[deterministic:` `ceil(chars / 4)` `]` |
| Vetting state | `[new:` `skills.needs_vetting`, `skills.vetted_body_hash` `]` |

## Untrusted inputs

Until a person vets it, treat each of these as untrusted: an imported skill's body, its
frontmatter, and every file name and file content inside an archive.

- The client never evaluates archive content. It reads `SKILL.md` as UTF-8 text
  (`TextDecoder` with `fatal: true`, NUL bytes rejected) and lists other entries by name.
  Names render as JSX text only.
- The server ignores client-supplied `enabled`, `source` trust and `needs_vetting` for
  imports. zod bodies are `.strict()`.
- A vetted skill is trusted as an instruction, and that trust has limits. `INJECTION_GUARD`
  closes the system message and states that skills may add checks but cannot waive
  findings or turn untrusted blocks into instructions.
- Markdown previews keep react-markdown's default `urlTransform`, which drops
  `javascript:` URLs. They render images as links and open links with
  `rel="noopener noreferrer"`.
- Traces contain full skill bodies. Anyone who can read a trace can read the skills
  behind it. This matters once traces leave the machine (CI export, L06).

## Control experiment

The experiment is written down before it runs, so the result cannot shape the rubric.

| PR | Agent | Defect | Expected finding |
|---|---|---|---|
| #490 refund validation | Test Quality Reviewer | New branch `amount > captured` untested; only the happy path has a test | Uncovered branch + missing boundary case `amount == captured` |
| #491 payments route | API Contract Reviewer | `/payments/:id` → `/payments/:paymentId`, `currency` becomes required | Breaking change for existing clients |
| #492 held-out | both | A different breaking change and an untested error branch the skills were not written against | Same classes of finding |

Protocol:

1. Same agent, model and strategy in both arms. Arm A: links disabled. Arm B: links
   enabled.
2. Diff the two `prompt_assembly` records and confirm only the skills block differs.
3. Run each arm three times per PR.
4. Record per run: hit or miss on the expected finding, false-positive count,
   `skills_tokens`, `tokens_in`, cost.
5. Report the result as measured, including a failure to reproduce.

## Final checklist

- [ ] `pr-self-review` exists with auto-invocation off; a manual run pulled both frontend
      and backend skills.
- [ ] A skill is created and edited in the UI.
- [ ] Both new agents have skills attached.
- [ ] An enabled skill shows as its own block in the trace; a disabled one does not.
- [ ] An import went through the preview, and the archive's script never ran (no marker file).
- [ ] The control experiment reproduces on both agents.

## Open questions

1. **Per-chunk repetition.** Map-reduce repeats the skills block for every file. Prompt
   caching would make that cheap on Anthropic and OpenAI, and nothing here enables it.
   `platform/model-router.ts` has a `PromptCache` scaffold for a later lesson.
2. **Token estimate bias.** `chars / 4` undercounts non-Latin text. If skills written in
   Ukrainian become common, the budget in AC-18 should move to a real tokenizer.
3. **Vetting identity.** In local no-auth mode "who vetted" is always the seeded user. The
   column records a hash, not a person, until auth lands.
