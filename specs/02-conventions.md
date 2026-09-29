# Spec: Conventions Extractor

**Spec ID:** SPEC-02-CONV · **Status:** Draft · **Lesson:** L02

**Affected modules:** `server` (new `conventions` module · `_shared` seams · skills · agents ·
reviews · db · container · app boot) · `client` (new `repos/[repoId]/conventions` route ·
skills components · vendor/ui nav, Tabs, Checkbox · next.config) · `reviewer-core` (prompt
exports) · LLM adapters (per-request signal) · vendored shared contracts ×2 ·
`docs/experiments/api-contract` · `docs/adr/0016-extracted-skill-trust-tier.md`

## Problem & Motivation

SPEC-02 (Skills) gave the team a place to keep rules. Nobody fills it. A team's real
conventions live in its code and in the comments reviewers leave, and writing them down as
skills by hand means reading the repo again.

The `conventions` table exists since migration `0000_init.sql`. It is unwired and empty, and
its shape cannot support this feature: it has no line numbers, no `rejected` state (only an
`accepted` boolean), no link to a scan and no evidence beyond one path and snippet. Storing a
fresh row per scan would also change ids on every scan, so a selection, a decision or a skill
link could point at a row the user no longer sees. The rebuilt model below keeps one stable
identity per convention and stores each scan's findings as observations.

Two risks decide the design:

- **Hallucinated evidence.** A candidate that cites code the repo does not contain is worse
  than no candidate. Every evidence quote must be found in a real file at a pinned commit.
- **Trust.** A skill created from extracted rules goes into the agent's prompt with the
  authority of an instruction, and its text came from repo code. ADR 0016 (written with this
  spec) records the trust tier that `extracted` skills get.

The second half of the homework is a control experiment. SPEC-02's API Contract Reviewer arm
did not reproduce: the no-skills arm already caught the breaking change (see
`specs/02-skills-rubric.md` § Results, which names a subtler fixture as the next step). This
spec builds that fixture and reruns the experiment.

## Goals / Non-goals

### Goals

1. You can run a conventions analysis on an indexed repo. It runs as a background job and the
   page shows progress.
2. You see every candidate convention with real code evidence. Clicking evidence opens GitHub
   at the scan's pinned commit SHA.
3. You accept, reject or edit each candidate. Decisions survive re-scans.
4. You select accepted conventions and create one or many skills from them, with an editable
   body and metadata, and link the skill to agents in the same step.
5. Rejected conventions never enter a skill. A rejected rule is fed back to the next scan as
   "do not propose".
6. The page shows scan statistics: counts, model, tokens, cost, duration.
7. Extraction quality: support count, stratified sampling and recurring review findings as
   extra signal.
8. A control experiment shows API Contract Reviewer with four skills catching a subtle
   breaking change that it misses without them.

### Non-goals

| Excluded | Why |
|---|---|
| Rules derived from config files (eslint, tsconfig, prettier) as a separate source | Future work. Config files go into the sample as context only (D12) |
| Auto-updating a skill when a convention changes | Skills are snapshots (D9). Editing the skill is manual |
| Auto-accepting candidates | Every skill body is human-reviewed before save (D10) |
| Scanning without a clone and an index | Repo Intel owns both. The scan returns 409 instead |
| A tokenizer | `lib/tokens.ts` keeps the `ceil(chars / 4)` estimate from SPEC-02 D4 |
| Per-file or per-directory scoping of a convention | One repo-wide rule per candidate |
| A separate `rationale` field per convention | Future. The rule text carries the "what"; the preamble and evidence carry the "why" for the reviewer (G13) |
| Retention of scans beyond 10, except referenced ones | See Data model |

### Decisions

Grilled with the user, then validated by two independent reviewers. Decisions changed by that
validation point to an entry (V#) in the [Validation log](#validation-log) at the end of this
spec.

| # | Decision | Rationale |
|---|---|---|
| D1 | Own design first. After spec approval, one subagent compares it with reference commit `641b637` and returns only a gap list, no code. Nobody opens the reference before that | Keeps the design independent and gives an honest comparison. See Open questions 1 |
| D2 | Extract is a `JobRunner` job. `POST …/extract` returns `202 {scan_id}` and the client polls while a scan runs | A scan takes tens of seconds; a request would time out |
| D3 | `convention_scans` plus conventions with explicit status. The commit SHA is pinned per scan. Refined by V1: stable identity plus observations | Evidence links must survive branch movement |
| D4 | Model resolved through `resolveFeatureModel(ws, 'conventions')` from the container. Default `provider: openrouter`, `model: deepseek/deepseek-v4-flash` (price-book slug, `adapters/llm/pricing.ts:40`) in both vendored `platform.ts` copies. Overridable in Settings → Models. V18 | One feature-model mechanism; provider and model stay separate fields |
| D5 | VERIFY is strict with relocation. The path must be in the sent sample and pass the path guard. A quote found after whitespace normalisation gets corrected lines. A quote not found is dropped. The stored snippet is the real file lines | The LLM's line numbers are unreliable; its quotes are checkable |
| D6 | Re-scan never loses decisions. Rejected rules go back to the model as "do not propose". Refined by V1 and V2 (`prior_ref` matching) | A rejected rule reappearing every scan would train users to ignore the page |
| D7 | Inline edit of rule and category. Evidence is read-only. An "edited" badge marks changed rules | Evidence is what makes a candidate checkable, so it cannot change |
| D8 | Tabs All / Accepted / Rejected with counts. Pending candidates appear only in All. Selection checkboxes appear only in Accepted. `selected > 0` enables "Create skill" | Selection can only contain vetted candidates |
| D9 | Convention ↔ skill is many-to-many. Cards show "in: skill-name" badges. One convention can feed several skills | Users split conventions by theme |
| D10 | Trust tier `extracted` (ADR 0016). "Create" in the modal is the vetting act: `needs_vetting = false`, `vetted_body_hash` set, enabled from the toggle. Body hygiene applies. A later body edit resets vetting. Residual risk in V20 | The user reads the full body before saving, so a second vetting step adds friction without information |
| D11 | Link to agents: (a) "Attach to agents" multiselect in the modal; the server appends links in the same transaction; (b) refined by V14: a success panel inside the modal with "Open skill" and "Open agent → Skills tab" replaces an action toast | Toasts auto-dismiss, which fails accessibility |
| D12 | In scope: support count, stratified sample, review-history mining, scan stats (counts, model, tokens, `cost_usd` plus `cost_source`, duration). Future: rules derived from config | Quality signals the homework asks for |
| D13 | Review mining supplies recurring findings (≥ 2 PRs) as `<untrusted>` signals and forces their files into the sample. Evidence is still code at HEAD | Review comments hint; only code proves |
| D14 | Experiment PR is subtle: DTO field rename outside route files, optional → required, enum narrowing, silent removal without `@deprecated`, no version bump. Generic agent prompt. The rubric needs file:line, client impact and a major-version or deprecation path. 3 runs × 2 conditions | SPEC-02's fixture was too obvious for the model |
| D15 | Target repo is the DevDigest fork. PR branch `demo/api-breaking-change`, never merged | Keeps the experiment reproducible |
| D16 | File `specs/02-conventions.md`. Route `repos/[repoId]/conventions`. Sidebar group SKILLS LAB. Confidence ≥ 0.80 green, 0.60–0.79 amber, < 0.60 red. Category enum `naming · structure · error-handling · async · typing · testing · imports · api · other`. The body is built by a pure client helper and the server re-validates it. Experiment skills in `docs/experiments/api-contract/skills/`; fixture `fixtures/skills/api-breaking-change` imported through the Import drawer | Naming and placement |

## User stories

- As an engineer, I open a repo's Conventions page and start an analysis, then watch it run
  without blocking the app.
- As an engineer, I see every detected convention with a category, a confidence bar and code
  evidence I can open on GitHub at the exact commit.
- As an engineer, I accept or reject each candidate, and a re-scan keeps my decisions.
- As an engineer, I fix a rule's wording or category inline when the model got it nearly right.
- As an engineer, I select several accepted conventions and open one modal that builds a
  skill body from them.
- As an engineer, I edit the body and metadata, see its size against each chosen agent's
  remaining 24 KB budget, and save, or cancel without losing work by accident.
- As an engineer, I attach the new skill to agents in the same modal, then jump to the skill
  or the agent's Skills tab.
- As an engineer, I read scan statistics (files sampled, verified vs dropped, tokens, cost,
  duration) to judge how far to trust the run.

## Acceptance criteria (EARS)

### API

- **AC-1** When `POST /repos/:id/conventions/extract` is called for a cloned and indexed repo,
  the server shall insert a scan with status `running`, enqueue the job and return
  `202 {scan_id}`. The route shall be rate limited to 5 per minute.
- **AC-2** If a scan is already running for the repo, then the server shall return 409
  `scan_running` with `{scan_id}` in the details. The partial unique index
  `(repo_id) WHERE status = 'running'` shall enforce this; a 23505 maps to the same 409.
- **AC-3** If the repo is not cloned, its clone directory does not exist on disk, or its
  index is neither `full` nor `partial`, then the server shall return 409 `repo_not_cloned`
  or `repo_not_indexed`. (G4: a stale `clonePath` must not produce a silent empty scan.)
- **AC-4** When `GET /repos/:id/conventions` is called, the server shall return a
  `ConventionsPage` with `last_scan`, `running_scan`, `latest_done_scan` and `candidates`,
  including a failed scan. Candidates shall be ordered by status (pending, accepted,
  rejected), then confidence descending, then `created_at` descending. (G12) A `pending`
  identity that was never edited and that the latest done scan did not observe
  (`seen_in_latest = false`) shall not be returned; accepted, edited and rejected identities
  are always returned. The filter hides rows only; no identity is deleted.
- **AC-5** When `PATCH /conventions/:id` is called with a strict body `{status?, rule?
  (8..300), category?}`, the server shall return the updated `ConventionCandidate`. It shall
  return 422 for an empty rule or one with invisible characters.
- **AC-6** When `POST /repos/:id/conventions/skills` is called with valid input, the server
  shall return `201 {skill, linked_agent_ids}`. The body takes `{name, description?, body,
  enabled, convention_ids[1..50], agent_ids[0..20]}`.
- **AC-7** The server shall scope every convention query by `workspace_id` and `repo_id`.
  If any convention id, agent id or repo id belongs to another workspace or repo, then the
  server shall return 404.
- **AC-8** The server shall force `type = 'convention'` and `source = 'extracted'` on skills
  created this way. Public `POST /skills` shall stay unchanged.

### Pipeline

- **AC-9** When a scan job starts, the server shall record the current HEAD commit SHA on the
  scan and use it for every evidence link of that scan. Before PERSIST it shall read HEAD
  again; if HEAD moved (a resync ran `reset --hard` during the scan), then the attempt shall
  fail with `head_moved` so evidence read from the working tree always matches the pinned SHA.
  (Trap 7)
- **AC-10** While sampling, the server shall build a sample of at most 12 code files chosen
  by rank, at most 3 per directory group (first two path segments), round-robin, plus at
  most 4 config files and at most 4 forced files from recurring findings. Each file shall be
  cut to 200 lines and 6 KB, and the total shall stay within 60 KB.
  - Config files are tried in this order and missing, unreadable or empty ones are skipped
    without failing the scan: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `package.json`,
    `tsconfig.json`, `eslint.config.*` / `.eslintrc*`, `.prettierrc*`, `biome.json`,
    `.editorconfig`. (G8)
  - Each file is rendered with a 1-based line-number gutter (`  23| code`). A file cut by a
    limit ends with a visible `… truncated at line N` marker. (G5, G9)
  - The **sent set** is exactly the files that reached the prompt after the 60 KB cut, not
    every file that was read. (Trap 6)
- **AC-10a** If the sample holds zero code files after reading (including when Repo Intel is
  disabled), then the scan shall become `failed` with `empty_sample` and no LLM call. (G4)
- **AC-11** Before every `readFile`, the server shall pass the path through the safe-path
  guard.
- **AC-12** When at least two PRs share a recurring finding, the server shall pass it to the
  model as an `<untrusted>` signal with a short id and add its file to the sample.
- **AC-13** The server shall call the model once per attempt with structured output, at most
  6000 output tokens, temperature 0, the remaining scan time as timeout and an abort signal.
  The call shall use JSON mode (`responseFormat: 'json_object'`) with the shape spelled out in
  the system prompt, and reasoning disabled (`disableReasoning`). Measured on
  `deepseek/deepseek-v4-flash`: with `json_schema` (strict or not) OpenRouter upstreams return
  the keys sorted alphabetically, `category` and `llm_confidence` first, which defeats the order
  below; with reasoning on, the whole 6000-token cap went to hidden reasoning and `content` came
  back `null` (`finish_reason: length`, ~50 s). A `finish_reason: length` reply shall fail the
  call at once, with no repair attempt. The reply shall be parsed per item: an invalid quote is
  dropped, an invalid `counter_example` becomes null, an invalid candidate is dropped and counted
  in `found_count` and `dropped_count`; only a reply without a `candidates` array goes to repair.
  The reply shall start with an `observed_patterns` survey of at most 5 notes under 15 words
  each, before `candidates` (ignored by the parse; with reasoning off, some upstreams otherwise
  answered `[]` in 7-9 tokens). The prompt shall say the survey does not cap the candidates.
  On OpenRouter the call shall send provider routing `CONVENTIONS_PROVIDER_ROUTING`
  (`constants.ts`): `sort: 'throughput'`, `ignore: ['deepinfra', 'digitalocean']`, fallbacks
  on. The default price-weighted balancing picks a random upstream per call; measured with a
  13-file sample, the fastest upstream answered in 10-16 s, while the previous round saw two
  upstreams return `[]` and one send nothing before the deadline.
  The schema shall allow at most 8 candidates, each with 1–3 evidence quotes of at most 240
  characters. Fields shall be declared in generation order `rule → evidence →
  counter_example → origin → signal_id → prior_ref → category → llm_confidence`, so the
  model classifies and scores after it has written the rule and its evidence. (G2: with
  category and confidence first, a reference run labelled all 12 candidates with one category
  and scored all of them 0.90.)
- **AC-13a** The system prompt shall tell the model: no generic advice (things any linter or
  framework already enforces), no rule backed by a single trivial line, an empty list is a
  valid answer, use the whole category range, and scores must separate candidates. (G10)
- **AC-14** When verifying, the server shall drop a rule that contains invisible characters.
  For each quote it shall require that the path is in the sent set, relocate the quote by
  whitespace-normalised search, correct the lines, and store the real file lines (at most
  12) as the snippet. A quote not found shall be dropped. Before matching:
  - the path is normalised (leading `./` and a trailing `:N` or `:N-M` removed); a path that
    is not an exact member of the sent set matches only if it is a **unique** suffix of one
    sent path, otherwise it is dropped (G6);
  - a line-number gutter the model copied into the quote is stripped (G5);
  - a quote with fewer than 8 non-whitespace characters is dropped, since it cannot identify
    a line (G3);
  - with several matches, the one nearest `line_hint` wins, else the first (G7).
- **AC-15** If a candidate has no verified quote, then the server shall drop it and count it
  in `dropped_count`.
- **AC-16** The server shall compute support as the number of distinct verified paths and
  confidence as `clamp(0.45·llm + 0.45·min(support,3)/3 + 0.10·signal − 0.30·counter)`.
  If support is below 2, then confidence shall not exceed 0.59.
- **AC-17** When the scan runs longer than 100 seconds from handler start, the server shall
  abort the LLM call and mark the scan `failed` with `scan_deadline_exceeded`. The deadline is
  terminal: it shall not be retried, so `failed` arrives at most ~100 s after the handler
  started (a retry gets the same budget against the same model and sample; with 3 attempts the
  scan took 301 s to fail).
- **AC-18** If the job throws or its retries run out, then the server shall mark the scan
  `failed`. Only `head_moved` and an LLM 429/5xx are retried. Before an attempt rethrows, it
  shall store the stats it reached (sample file count, model; tokens, cost and VERIFY counts
  once the LLM call returned), so a failed scan shows how far it got. At boot, the server shall
  mark scans still `running` as `failed`.

### Persistence

- **AC-19** When a scan finishes, the server shall write results in one transaction guarded
  by a compare-and-set on `status = 'running' AND attempt = ?`. If zero rows update, then
  the transaction shall roll back and write nothing.
- **AC-20** When a candidate matches a prior identity through a validated `prior_ref`, or by
  exact fingerprint, the server shall reuse that identity. Otherwise it shall create a new
  identity with status `pending`. The prior list sent to the model shall hold decided
  identities first, then `pending` identities observed by the latest done scan (highest
  confidence first), so a reworded pending rule can return its `prior_ref` and merge instead
  of creating a duplicate. Pending entries are marked `[pending]` in the prompt: they are
  not bans and not approvals.
- **AC-20a** If two candidates of one scan resolve to the same identity, then the server shall
  merge them into one observation: the candidate with the higher confidence keeps its rule,
  evidence from both is unioned (deduplicated by path and lines, capped at 3), and
  `duplicate_count` is incremented. The `(scan_id, convention_id)` key shall never conflict
  inside PERSIST. (G1)
- **AC-21** If a matched identity is `rejected`, then the server shall store the observation
  and keep the status `rejected`. The candidate shall not appear in All or Accepted.
- **AC-22** When a scan finishes, the server shall keep the 10 newest scans per repo plus any
  scan referenced by a convention's `last_seen_scan_id`. Identities and decisions shall
  never be deleted.
- **AC-23** The server shall store scan stats: sample file count, found, verified, dropped,
  relocated, matched-prior, duplicate counts, model, tokens in and out, `cost_usd`, `cost_source`,
  duration and retry count.

### Skill creation

- **AC-24** When you create a skill from conventions, the server shall run these steps in one
  transaction: validate the body with the shared skill rules and hygiene; load the
  conventions scoped by workspace and repo; lock the chosen agents with `FOR UPDATE`; insert
  the skill; check the budget for each agent; append links at `order = max + 1`; insert
  `convention_skills` rows.
- **AC-25** If any chosen convention is not `accepted`, then the server shall return 422
  `convention_not_accepted`. A rejected or pending convention shall never enter a skill.
- **AC-26** The server shall store the skill with `needs_vetting = false`,
  `vetted_body_hash = sha256(body)`, the enabled state from the request and
  `evidence_files` from the chosen conventions.
- **AC-27** If the skill name already exists in the workspace, then the server shall return
  409 `skill_name_taken` after the transaction aborts.
- **AC-28** If a chosen agent's enabled skills would exceed 24 KB, then the server shall
  return 422 `agent_skills_budget_exceeded` with `{agent_id}` and roll back the skill and
  every link.
- **AC-29** When you create several skills from the same or overlapping conventions, each
  skill shall be created independently, and a convention shall show every skill that
  contains it.
- **AC-30** When you edit the body of an `extracted` skill, the server shall reset
  `needs_vetting` and clear the vetted hash, as it does for imported skills.
- **AC-31** When a run starts for an agent linked to an enabled, vetted extracted skill, the
  skill's body shall reach the prompt and appear in the trace, through the existing hash
  gate.

### UI: Conventions page

- **AC-32** When you open `/repos/[repoId]/conventions`, the page shall render exactly one of
  six states: never scanned (CTA "Run analysis"), repo not indexed (CTA "Index repository" calling `POST /repos/:id/resync` via `useResyncRepoIntel`, then polling index state; the client has no Project Context route),
  scanning (skeletons, Re-scan disabled), failed (error and Retry), done with zero verified
  candidates (shows the dropped count), all rejected.
- **AC-33** When a scan finishes with candidates, the page shall list them as cards showing
  rule, category, confidence bar, and badges "edited", "in: skill", "not seen in latest
  scan", "flagged in N reviews" and "N cited examples".
- **AC-34** The header shall read "Detected from N sample files · last scan X ago" and show a
  stats strip with found, verified, dropped, relocated, model, tokens, cost and duration.
- **AC-35** Each evidence block shall show the real snippet, a copy button with an
  `aria-label`, and a link built with `githubBlobUrl(full_name, commit_sha, path, start,
  end)` that opens GitHub at the scan's pinned SHA and the cited lines.
- **AC-36** When you click Accept or Reject, the card shall move tabs at once and the tab
  counts shall update. If the request fails, then the client shall roll back. A polling
  refetch shall not overwrite a mutation in flight.
- **AC-37** When you edit a rule inline, the client shall save the new rule and category and
  show the "edited" badge. Evidence shall stay read-only.
- **AC-38** If you reject a convention that is already in a skill, then the client shall ask
  for confirmation, state that the skill keeps the rule, and link to the skill.
- **AC-39** In the Accepted tab, each card shall show a checkbox labelled with the rule. The
  effective selection shall be the intersection of selected ids and accepted ids.
  Select/Deselect all shall act on visible accepted cards. Selection shall clear after a
  successful create.
- **AC-40** Tabs shall use `role=tablist`, `role=tab` and `aria-selected`. Accept and Reject
  shall use `aria-pressed`.
- **AC-41** When a second click on Run analysis meets a 409 `scan_running`, the client shall
  attach to the returned `scan_id` and show no error toast.

### UI: Create-skill modal

- **AC-42** While `selected > 0`, the "Create skill" button shall be enabled. It shall open
  the modal.
- **AC-43** The modal shall offer Name (default `<repo-slug>-conventions`), Description, Type
  (fixed `convention`, disabled), an Enabled toggle and an editable body built by
  `buildConventionSkillBody`. Fences shall be longer than any backtick run in a snippet, and
  snippets shall be at most 12 lines. The body shall start with a preamble telling the
  reviewer to cite violations as `file:line` and that a rule the diff does not touch is not a
  finding; each rule section shall carry its evidence as ``Detected in `path:start-end` ``
  followed by the snippet. (G11)
- **AC-44** The modal shall offer a raw view that marks invisible characters, an estimated
  token count, and the body size in bytes against the remaining 24 KB of each selected agent.
- **AC-45** The modal shall offer "Attach to agents" as a searchable multiselect of up to 20.
- **AC-46** If the form is dirty, then Esc, backdrop click and Cancel shall ask for
  confirmation before closing.
- **AC-47** If the server returns 409 `skill_name_taken`, then the modal shall show the error
  next to the Name field and no global toast.
- **AC-48** When creation succeeds, the modal shall show a success panel with "Open skill"
  and, for each linked agent, "Open agent Skills tab". The panel shall stay until dismissed.

### Experiment

- **AC-49** The repo shall contain three experiment skills in
  `docs/experiments/api-contract/skills/` (`response-schema`, `semver-discipline`,
  `deprecation-policy`), each with a directive description and a good and a bad example.
- **AC-50** When you import `fixtures/skills/api-breaking-change` through the Import drawer,
  the skill shall arrive disabled and unvetted, per SPEC-02.
- **AC-51** When four skills (three above plus the imported one, after vetting) are linked to
  API Contract Reviewer, a review of `demo/api-breaking-change` shall flag the breaking
  change and shall show the skills in the RunTraceDrawer.
- **AC-52** When the same review runs without the skills, the rubric shall score it as a
  miss or as missing the required elements, in the three runs.
- **AC-53** The results shall be reported as measured in `results.md`, including a failure to
  reproduce.

## Edge cases

| Situation | Expected |
|---|---|
| Never scanned | State 1: CTA Run analysis |
| Repo not cloned or not indexed | State 2: "Index repository" (resync) with index-state polling. Extract returns 409 |
| Scan running | State 3: skeletons; Re-scan disabled; polling |
| Scan failed or timed out | State 4: error text, Retry. Older candidates stay readable |
| Scan done, 0 verified | State 5: message with dropped count |
| Every candidate rejected | State 6: message pointing to the Rejected tab |
| Pending convention absent from the latest scan | Not returned by `GET` (AC-4); the identity stays in the table and reappears if a later scan finds it |
| Accepted or edited convention absent from the latest scan | Stays visible with "not seen in latest scan" and its last evidence, linked at that scan's SHA |
| Reject a convention already in a skill | Confirm dialog; skill untouched |
| Two scans start at once | Partial unique index lets one win; the other gets 409 with the winner's id |
| Stale job retry writes after a newer attempt | CAS on `attempt` updates zero rows; nothing written |
| Model exceeds 100 s or hangs | Abort via signal; scan `failed`; no partial write |
| Evidence path with `..`, absolute path, NUL, or symlink escaping the clone | Rejected by safe-path; quote dropped |
| Path outside the sent sample | Dropped |
| Quote with whitespace drift | Relocated; lines corrected; `relocated_count` incremented |
| Body plus existing skills over 24 KB for an agent | 422 `agent_skills_budget_exceeded`; whole create rolled back; modal shows bytes before submit |
| Skill name already used | 409 inline in modal |
| Convention or agent id from another workspace or repo | 404, indistinguishable from "not found" |
| Convention id not accepted | 422 `convention_not_accepted` |
| Rule text contains U+E0000–E007F, bidi or zero-width characters | Dropped at VERIFY; 422 on PATCH |
| Body edited after create | Vetting resets; skill leaves the prompt until re-vetted |
| Snippet contains a run of backticks | Fence is longer than the longest run |
| Two candidates in one scan map to one identity | Merged into one observation; `duplicate_count` +1; PERSIST never conflicts |
| Clone directory deleted but `clonePath` still set | Extract returns 409 `repo_not_cloned` |
| Sample ends up empty (no code files, Repo Intel disabled) | Scan `failed` with `empty_sample`; no LLM call |
| Resync moves HEAD during a scan | Attempt fails with `head_moved`; job retry rescans at the new SHA |
| Model cites `./src/a.ts:12` or a path suffix | Normalised; unique suffix accepted, ambiguous suffix dropped |
| Model quotes `}` or `import` | Dropped: under 8 non-whitespace characters |
| Config file missing, unreadable or empty | Skipped; scan continues |

## Non-functional

| Budget | Value |
|---|---|
| Sample input | ≤ 60 KB; ≤ 200 lines and ≤ 6 KB per file; ≤ 12 code files plus ≤ 4 config files |
| Model output | ≤ 6000 tokens; ≤ 8 candidates; ≤ 5 `observed_patterns` notes; quote ≤ 240 characters; snippet ≤ 12 lines. Measured reply ≈ 1.4-2.3k tokens |
| Scan latency | Target ≤ 90 s per `done` scan on the default model; measured 15-16 s on 3 consecutive scans with provider routing (AC-13) |
| Deadline | 100 s per scan handler, from handler start |
| Retries | LLM `maxRetries` 1 (structured repair only; never after `finish_reason: length`), SDK retries 0, job retries 2 for `head_moved` and LLM 429/5xx only. `scan_deadline_exceeded` is terminal (status 408, not retried). Retry count recorded in stats |
| Rate limit | Extract 5 per minute |
| Retention | 10 scans per repo, plus referenced ones |
| Prior list | ≤ 40 identities, short ids `P1..Pn`: decided first (accepted, rejected, edited), then pending ones seen in the latest done scan by confidence descending |
| Skill body | Counts toward the 24 KB per-agent budget of SPEC-02 |
| Cost | Recorded per scan with `cost_source`. Default model price is $0.14 in / $0.28 out per million tokens (`pricing.ts:40`) |
| Polling | Client refetches only while `running_scan` is set |

## Inputs (provenance)

| Input | Provenance |
|---|---|
| Ranked files | `[reused:` `repoIntel.getTopFilesByRank` `]` |
| Repo file content | `[reused:` `server/src/adapters/git/simple-git.ts` `readFile` `]` behind a new guard |
| Path guard | `[new:` `server/src/modules/_shared/safe-path.ts` `]` |
| Recurring review findings | `[reused:` review tables `]` through `[new:` `reviewRepo.recurringFindings(repoId, minPrs, limit)` `]` |
| Prior decisions | `[new:` `conventions` rows with status `accepted`, `rejected` or edited `]` |
| Feature model | `[reused:` `resolveFeatureModel` and `FEATURE_MODELS` `]` with a new `conventions` entry |
| Structured LLM call | `[reused:` `completeStructured` `]` with `[new:` optional `signal` `]` |
| Prompt nonce and delimiter escaping | `[reused:` `reviewer-core/src/prompt.ts` `resolveNonce`, `neutralizeDelimiters` `]` exported |
| Skill tables and contracts | `[reused:` `skills`, `agent_skills`, `Skill` `]` extended with `vetted_body_hash`, `evidence_files` writes |
| Skill budget, hygiene, name and body rules | `[reused:` `agents/domain.ts:74,85`, `skills/domain.ts:58`, `skills/routes.ts:25-38` `]` moved to `modules/_shared` |
| Vetting policy | `[new:` `applySourcePolicy` in `_shared/skill-rules.ts` `]` replacing `applyImportPolicy` |
| GitHub link | `[reused:` `githubBlobUrl` in `client/src/lib/github-urls.ts` `]` |
| Polling pattern | `[reused:` `client/src/lib/hooks/repo-intel.ts` `]` |
| Raw body view | `[reused:` `SkillBodyPreview`, `InvisibleCharSegments` `]` moved to `client/src/components` |
| Token estimate | `[deterministic:` `ceil(chars / 4)` `]` in `lib/tokens.ts` |
| Fingerprint, confidence, stratification | `[deterministic:` `conventions/domain.ts` `]` |
| Convention tables | `[new:` `convention_scans`, `convention_observations`, `convention_skills` `]`; `conventions` rebuilt |

## Untrusted inputs

Treat these as untrusted: repo files in the sample, review findings used as signals, and
the LLM's output.

- **Repo files.** Sample content is code someone else wrote and can carry instructions.
  Files go into the prompt inside `<untrusted>` blocks with a per-call nonce from
  `newPromptNonce`; `neutralizeDelimiters` escapes delimiter text in them. Every path goes
  through `safe-path` (no absolute paths, `..` or NUL; `lstat` not a symlink; `realpath`
  under the clone root) before `readFile`.
- **Review findings.** Signals enter as `<untrusted>` text with short ids. They steer
  sampling and give the model a hint. They are never evidence: evidence is code at HEAD,
  found by VERIFY.
- **LLM output.** Rules with invisible characters are dropped. Paths must be in the sent
  set. Quotes must be found in the files. `prior_ref` must match a sent id. The stored
  snippet is real file text, never the model's text.
- **Skill body.** The client builds the body, and the server re-validates it with the shared
  hygiene rules (invisible characters, size, name). A later body edit resets vetting.
- **Residual risk (V20).** Natural-language injection from repo code can sit inside an
  auto-vetted body. Mitigations: the user reads the full raw body before saving; snippets are
  capped at 12 lines; hygiene applies; `INJECTION_GUARD` stays last in the system message.
  ADR 0016 records this risk. D10 stays as the user decided.

## Data model

Migrations come from `drizzle-kit generate` in two steps (create and alter, then drops) to
avoid rename prompts. `*.it.test.ts` validates them; nobody runs them against a shared dev
database.

- **`convention_scans`**: `id`, `workspace_id`, `repo_id` (NOT NULL), `status` CHECK
  `running|done|failed`, `job_id`, `attempt`, `commit_sha`, `sample_file_count`, found /
  verified / dropped / relocated / matched-prior / duplicate counts, `model`, `tokens_in`, `tokens_out`,
  `cost_usd`, `cost_source` CHECK, `error`, `started_at`, `finished_at`. Index
  `(repo_id, started_at desc)`; partial unique `(repo_id) WHERE status = 'running'`.
- **`conventions`**: a stable identity per repo, rebuilt. `id`, `workspace_id`, `repo_id`,
  `fingerprint`, `category` CHECK, `origin` (`code|review_history`), `rule`, `original_rule`,
  `status` CHECK default `pending`, `edited_at`, `decided_at`, `created_at`,
  `last_seen_scan_id` (SET NULL). `unique(repo_id, fingerprint)`. The migration deletes
  legacy rows first and drops `accepted`, `evidence_path`, `evidence_snippet`, `confidence`.
- **`convention_observations`**: PK `(scan_id, convention_id)`, both cascade. `evidence`
  jsonb with `CHECK (jsonb_typeof(evidence) = 'array')`, `support_count`, `counter_count`,
  `review_hits`, `llm_confidence`, `confidence`, `relocated`. Index on `convention_id`.
- **`convention_skills`**: PK `(convention_id, skill_id)`, index on `skill_id`.

Why this shape: ids stay stable across scans, so selection, PATCH and skill links never point
at invisible rows (V1). Decisions live on the identity, not on scan rows.

## API

| Method | Path | Body | Response | Errors |
|---|---|---|---|---|
| POST | `/repos/:id/conventions/extract` (rate limit 5/min) | none | `202 {scan_id}` | 404 · 409 `scan_running` `{scan_id}` · 409 `repo_not_indexed` / `repo_not_cloned` |
| GET | `/repos/:id/conventions` | none | `ConventionsPage` | 404 |
| PATCH | `/conventions/:id` | `{status?, rule?(8..300), category?}` strict | `ConventionCandidate` | 404 (other workspace too) · 422 hygiene or empty |
| POST | `/repos/:id/conventions/skills` | `{name, description?, body, enabled, convention_ids[1..50], agent_ids[0..20]}` | `201 {skill, linked_agent_ids}` | 404 (any id outside workspace or repo) · 409 `skill_name_taken` · 422 `convention_not_accepted` · 422 hygiene · 422 `agent_skills_budget_exceeded {agent_id}` |

Routes parse, call the service and map to a DTO. They hold no logic.

## Pipeline

```
startScan: repo cloned and index full|partial, else 409
           insert scan running (23505 -> 409 {scan_id})
           enqueue; job.done.catch(markFailed)
runScanJob (deadline 100s, AbortController from handler start):
  attempt <- bumpAttempt; sha <- currentHead
  SAMPLE   signals <- reviewRepo.recurringFindings(repo, >=2 PRs, 10); forced files <= 4
           ranked <- getTopFilesByRank(200) -> stratify
             (dirKey = first 2 segments, <= 3 per group, round-robin, 12 - forced)
           configs <= 4; every path through safePath
           per file <= 200 lines / 6 KB; total <= 60 KB
           prior <- decided identities (accepted/rejected/edited), <= 40, ids P1..Pn
  PROPOSE  featureModel -> completeStructured({schema, timeoutMs: remaining, signal,
             maxRetries: 1, maxTokens: 6000, temperature: 0})
           candidates <= 12 of {rule 8..300, evidence Quote[1..3],
             counter_example Quote|null, origin, signal_id|null,
             prior_ref (P\d+)|null, category, llm_confidence}   // generation order (AC-13)
           Quote {path, quote <= 240, line_hint|null}
           (0 code files in sample -> failed empty_sample, no LLM call)
  VERIFY   drop rule with invisible chars
           per quote: normalise path (./, :N, unique suffix), strip gutter,
             drop if < 8 non-ws chars, path in sent set, relocate (nearest hint),
             snippet = real lines (<= 12)
           support = distinct verified paths; 0 -> dropped
           confidence = clamp(0.45*llm + 0.45*min(support,3)/3 + 0.10*signal
                              - 0.30*counter); support < 2 -> cap 0.59
  PERSIST  HEAD still == sha, else fail head_moved
           merge candidates resolving to one identity (duplicate_count)
           one tx; CAS UPDATE scans ... WHERE status='running' AND attempt=?
             (0 rows -> rollback)
           identity <- prior_ref (validated) ?? exact fingerprint ?? new (pending)
           rejected identity matched -> observation stored, stays rejected
           upsert observation; last_seen_scan_id = scan; stats; retention cleanup
```

`createSkill` runs as one unit of work: validate body → load conventions (workspace, repo) →
all accepted, else 422 → `SELECT … FROM agents WHERE id = ANY($1) FOR UPDATE` → insert skill
with `applySourcePolicy('extracted')` and `evidence_files` → budget check per agent →
append links at `max + 1` under the lock → insert `convention_skills`. A 23505 on the name
becomes 409 after the transaction aborts.

Supporting seams (P2, P3 of the plan): `_shared/{skill-budget,text-hygiene,skill-rules,
safe-path}.ts` keep `modules-no-cross-import` (`.dependency-cruiser.cjs`) intact;
`container` gains `skillsRepoOn(tx)`, `agentsRepoOn(tx)` and `featureModel`; the boot code
in `app.ts` calls `conventionsService.reapStaleScans()` next to `reapStaleRuns`.

## Control experiment

The protocol lives in `specs/02-skills-rubric.md` and applies unchanged: same agent, model
and strategy in both arms; arm A with skill links disabled, arm B with them enabled; three
runs per arm; diff the two `prompt_assembly` records and confirm only the skills block
differs; record hit or miss, false positives, `skills_tokens`, `tokens_in` and cost; report as
measured. The rubric for this experiment is written to `docs/experiments/api-contract/
protocol.md` before any run.

What D14 changes:

- **The PR.** Branch `demo/api-breaking-change` on the DevDigest fork (D15), never merged. It
  renames a DTO field outside the route files, makes an optional field required, narrows an
  enum, and removes a field silently without `@deprecated`. No version bump.
- **The agent.** API Contract Reviewer keeps a generic prompt, so the delta comes from
  skills.
- **The hit.** The run cites file:line, names the client impact and names a major-version or
  deprecation path.
- **Runs.** 3 runs × 2 conditions.
- **The skills.** Three in `docs/experiments/api-contract/skills/`: `response-schema`,
  `semver-discipline`, `deprecation-policy`. The fourth is `fixtures/skills/api-breaking-change`,
  imported through the Import drawer and vetted before arm B.
- **Results.** `docs/experiments/api-contract/results.md`.

## Test plan

**Server unit**

- `conventions/domain.test.ts`: relocate incl. whitespace drift; hallucinated quote dropped;
  single-file support cap; stratify; fingerprint stability; prior matching; gutter strip;
  `./` and `:N` path normalisation; ambiguous suffix refused; quote under 8 characters
  dropped; nearest-hint pick; in-scan duplicate merge.
- `conventions/llm-schema.test.ts`: field order of the candidate schema is the generation
  order from AC-13 (guards against a reorder that silently flattens scores).
- `conventions/service.test.ts` with `MockLLMProvider` and
  `structuredBySchema['ConventionExtraction']`: happy SAMPLE → PERSIST; stale attempt writes
  nothing; path outside the sample dropped; deadline abort → failed; empty sample → failed
  without an LLM call; HEAD moved before PERSIST → attempt fails; a file cut by the 60 KB
  budget is not in the sent set.
- `_shared/safe-path.test.ts`: `..`, absolute path, symlink.
- `_shared/skill-rules.test.ts`: extracted policy; body edit resets vetting.
- Prompt nonce and `neutralizeDelimiters` test.

**Server integration** (`*.it.test.ts`)

- `conventions/routes.it.test.ts`: extract → `jobs.onIdle()` → GET → PATCH accept → POST
  skills with an agent → 201 and link appended; a second scan keeps ids, decisions and
  `convention_skills`; a failed scan is visible in GET; parallel scan → 409; budget → 422 with
  rollback; name → 409; pending → 422; cross-workspace and cross-repo ids → 404.
- Extend `test/run-executor-skills.it.test.ts`: an extracted skill reaches the prompt through
  the hash gate.
- `server/test/contracts.test.ts` updated for the new contracts.

**Client**

- `ConventionsView.test.tsx`: six states; tabs with counts; selection derivation.
- `ConventionCard.test.tsx`: inline edit; a11y.
- `TransformToSkillModal.test.tsx`: payload; dirty confirm; inline 409; budget warning.
- `helpers.test.ts`: fences; tone thresholds; slugify.

**Verification commands**

- `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run .it.test && pnpm arch:check`
- `cd client && pnpm typecheck && pnpm test`
- `cd reviewer-core && pnpm typecheck && pnpm test`
- Integration tests skip silently without Docker (`server/test/helpers/pg.ts:10`). The run
  counts only with Docker up and the vitest summary showing the `*.it.test.ts` files as
  **run, not skipped**; CAS, migrations, 409 races and rollbacks are proven only there. (Trap 5)
- Browser walk-through on a worktree database (`pnpm db:migrate && pnpm db:seed`,
  `./scripts/dev.sh`): Conventions → Run → scanning → cards → evidence link opens GitHub at
  the SHA → accept, reject, edit → Re-scan keeps decisions → Accepted → select → modal →
  attach to API Contract Reviewer → run a review → skills visible in RunTraceDrawer.
  Type-check alone does not count (`extensionAlias` in `next.config.mjs` needs a browser
  check).

## Final checklist

- [ ] Analysis results are visible in the UI at `/repos/[repoId]/conventions`, with all six
      states, and scan stats.
- [ ] Every candidate has evidence with real code; the link opens GitHub at the pinned SHA.
- [ ] Accept, reject and inline edit work and survive a re-scan.
- [ ] One or several skills can be created from accepted conventions, with an editable body
      and metadata.
- [ ] Rejected conventions cannot enter a skill (422 covered by test).
- [ ] A created skill links to an agent and appears in the review's RunTraceDrawer.
- [ ] API Contract Reviewer with four skills flags the subtle change that it misses without
      them; `results.md` written as measured.
- [ ] ADR 0016 written; READMEs updated; INSIGHTS filed through `engineering-insights`.
- [ ] Verification commands above pass.
- [x] D1 gap review against `641b637` done and its gap list handled (see Gap review).
- [ ] Demo video recorded.
- [ ] PR opened.

## Validation log

Two reviewers checked the draft plan independently against the repo's skills
(`.claude/skills/*`) and ADRs. Every finding below was confirmed in code before it changed
the plan.

| V | Finding | Evidence | Resolution |
|---|---|---|---|
| V1 | Per-scan rows change ids, so selection, PATCH and skill links hit invisible rows | design | Stable `conventions` identity plus `convention_observations` |
| V2 | A fingerprint over free LLM text rarely matches across scans | design | `prior_ref` matching, exact fingerprint as fallback, prior list ≤ 40 |
| V3 | Failed, never-scanned, not-indexed and empty scans had no UI state | design | `last_scan` in the page DTO; six explicit states (AC-32) |
| V4 | LLM timeout and retries were unbounded; no output cap | `reviewer-core/src/llm/openrouter.ts:55-56` fixes timeout and retries at construction | Per-request `signal`, `timeoutMs`, SDK retries 0; 100 s deadline; 6000 output tokens |
| V5 | `readFile` follows `..` and symlinks | `server/src/adapters/git/simple-git.ts:129` | `_shared/safe-path.ts` |
| V6 | Skill rules would be duplicated; `applyImportPolicy` forces every non-manual skill disabled | `server/src/modules/skills/domain.ts:94` | `_shared/skill-rules.ts` with `applySourcePolicy` |
| V7 | Appending agent links had no lock | `server/src/modules/agents/repository.ts:217` | `FOR UPDATE` on agents; `order` computed under the lock |
| V8 | Convention and agent ids were not scoped (IDOR) | design | Workspace and repo scoping, 404 (AC-7) |
| V9 | ADR 0007 response schemas need `extensionAlias` | missing in `client/next.config.mjs` | Added first in the client phase; checked in a browser |
| V10 | Migration on the legacy table, duplicate evidence columns, missing FK index | `server/src/db/schema/knowledge.ts:31` | Rebuilt tables; legacy rows deleted; indexes; jsonb CHECK |
| V11 | A double click on Run, and a name clash, would show a global error toast | `client/src/lib/query-client.ts:62` | Attach to the running scan; `errorSurface: "local"` |
| V12 | Modal dropped edits silently; Type editable; default name could fail the slug rule; raw-view components live in a cousin route | `vendor/ui/kit/Modal.tsx`, ADR 0010 | Dirty confirm, fixed Type, `slugifySkillName`, components moved to `src/components` |
| V13 | No optimistic update, tab counts, derived selection or ARIA roles | `vendor/ui/kit/Tabs.tsx` has no roles | AC-36, AC-39, AC-40 |
| V14 | A toast with actions that auto-dismisses fails accessibility | `client/src/lib/toast.tsx:16` | Success panel in the modal (AC-48); toast unchanged |
| V15 | The 24 KB agent budget surfaced only as a 422 after submit | `server/src/modules/agents/domain.ts:85` | Bytes against remaining budget in the modal (AC-44) |
| V16 | Reaper placed in routes; review SQL read from the conventions module | `server/src/app.ts:80` | Reaper in `app.ts`; `reviewRepo.recurringFindings` |
| V17 | "Seen in N files" overstated prevalence | design | Label "N cited examples" |
| V18 | Model id did not match the price-book slug | `server/src/adapters/llm/pricing.ts:40` | Provider and model as separate fields (D4) |
| V19 | LLM rule text was not sanitised | design | VERIFY drops rules with invisible characters (AC-14) |
| V20 | Natural-language injection can sit inside an auto-vetted body | design risk | Documented in ADR 0016; snippet cap; D10 kept by user decision |
| V21 | Missing tests for CAS, carry-over, traversal, failed state, hash gate | `TESTING.md` | Added to the Test plan |
| V22 | `scanId` vs `scan_id` naming | plan | `scan_id` everywhere |

## Gap review (D1)

Run after spec approval: one reviewer compared this spec with reference commit `641b637` and
its later fix `82cb028`, read-only, and returned behaviour gaps only (no code). Each finding
was checked before it changed the spec.

| G | Gap | Resolution |
|---|---|---|
| G1 | Two candidates of one scan can resolve to one identity and break the observation key | AC-20a merge + `duplicate_count` |
| G2 | Schema field order is generation order; category and confidence first flatten both | AC-13 order; `llm-schema.test.ts` |
| G3 | Very short quotes cannot identify a line | AC-14: ≥ 8 non-whitespace characters |
| G4 | Stale `clonePath` and empty samples produced silent empty scans | AC-3 disk check; AC-10a `empty_sample` |
| G5 | Model echoes the line-number gutter | AC-10 gutter format; AC-14 strip |
| G6 | `./`, `:N` and path suffixes from the model | AC-14 normalisation; unique suffix only |
| G7 | Repeated lines need a tie-break | AC-14 nearest `line_hint` |
| G8 | Config list and failure handling unspecified | AC-10 ordered list; skip on failure |
| G9 | Truncated files looked complete to the model | AC-10 truncation marker |
| G10 | System prompt content rules | AC-13a |
| G11 | Skill body lacked a reviewer preamble | AC-43 preamble and `Detected in` lines |
| G12 | Candidate order undefined | AC-4 |
| G13 | Reference stores an editable `rationale` | Non-goal (future) |
| Trap 5 | Integration tests skip silently without Docker | Verification: run must show `*.it.test.ts` executed |
| Trap 6 | Files cut by the budget stayed citable | AC-10: sent set = files in the prompt |
| Trap 7 | Evidence read from a working tree that a resync can move | AC-9: HEAD re-check before PERSIST |

Areas checked with no gap: routes (no DELETE, since identities are never removed), schema and
migration constraints, vendored contract changes, re-scan and accepted-only integration
tests, category fallback, slugify, client hooks. Reference client components
(`ConventionCard`, `CreateSkillModal`, `page.tsx`) were only skimmed for link building.

## Open questions

1. **Experiment outcome.** A subtle PR may still not separate the arms. The plan reports the
   result either way and defines no second fixture.
2. **Extracted-skill vetting risk.** V20 stays open by user decision: D10 auto-vets on
   create. The plan does not define a per-source override or an audit view.
3. **Conventions from config files.** Deferred (D12). The plan defines no extraction path
   for them beyond sample context.
4. **Model slug drift.** D4 relies on the price-book slug. The plan defines no fallback if
   the provider retires `deepseek/deepseek-v4-flash`; Settings → Models is the override.
