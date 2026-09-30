# Spec: Skill impact API (versions, stats, evals)

**Status:** implemented (server + client) · **Branch:** `feat/skill-impact`

This file is the handshake between the server and client work for Phases 1-3 of the
skill-impact plan. Every request and response schema named here is exported from
`@devdigest/shared` (`contracts/skill-impact.ts`, plus `ImpactVerdict`,
`SkillLatestVerdict` and the extended `SkillListItem` in `contracts/knowledge.ts`).
Both vendored copies are identical (ADR 0001). If an endpoint needs a shape that is
not listed, change the contract in both copies first, then this file.

## Conventions

- Errors use the shared envelope `{ error: { code, message, details } }`
  (`server/docs/request-lifecycle.md`).
- A request that fails its route schema (body, params or querystring) returns
  **422 `validation_error`**. That is how the global error handler treats every
  zod route failure, so there is no 400 anywhere in this API.
- `:id` and other row ids are uuids (`IdParams`). `:version` is
  `z.coerce.number().int().positive()`, like `/agents/:id/versions/:version`.
  A non-numeric version is 422, an unknown one is 404.
- Everything is workspace-scoped through `getContext`. A row from another
  workspace is 404, never 403.
- Costs are a pair (ADR 0002): `cost_usd` and `cost_source` are both null or
  both set.

## Phase 1: Versions

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| PUT | `/skills/:id` | `UpdateSkillBody` (gains optional `change_note`) | `Skill` | 404 `not_found` · 409 `skill_name_taken` · 422 |
| GET | `/skills/:id/versions` | none | `SkillVersionSummary[]`, newest first | 404 |
| GET | `/skills/:id/versions/:version` | none | `SkillVersion` | 404 (skill or version) · 422 (non-numeric) |
| POST | `/skills/:id/versions/:version/restore` | `RestoreSkillVersionBody` | `RestoreSkillVersionResult` | 404 · 409 `skill_version_stale` · 409 `skill_name_taken` · 422 |
| POST | `/skills/:id/vet` | `{ version }` (unchanged) | `Skill` | 409 `skill_vet_stale` now also fires after a rename |

Notes:

- A change to any of `name`, `description`, `type` or `body` bumps `version`
  and writes a snapshot. A change to `enabled` does neither. `insert` writes v1.
- `SkillVersionSummary.name/description/type` are null on snapshots written
  before the all-field migration. A version with no snapshot row is missing
  from the list, and the UI shows it as "vN body unavailable".
- Restore:
  - `expected_version` is the current skill version the client saw. A
    mismatch returns 409 `skill_version_stale` with
    `details: { expected_version, current_version }`, and it is checked on the
    no-op path too.
  - If the target snapshot already equals the current state, the response is
    200 with `restored: false`. Otherwise it appends vN+1 with
    `change_note = "Restored from vN"` and returns `restored: true`.
  - Vetting goes through `resolveVettingOnBodyEdit` + `assertEnableAllowed`,
    so restoring into an imported skill resets vetting.
  - The ADR 0012 body limits and the invisible-character check apply, which
    means a snapshot that fails them now is 422.
  - A restored `name` that another skill has taken since is 409 `skill_name_taken`.
- The client's "Edit" path in the restore popup calls no restore endpoint.
  It prefills Config from `GET …/versions/:version` and saves through `PUT`
  with the default `change_note = "Restored from vN (edited)"`.

## Phase 2: Stats

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/skills` | `?q=` (unchanged) | `SkillListItem[]` with `runs_30d` and `latest_verdict` | 422 |
| GET | `/skills/:id/stats` | `SkillStatsQuery` (`?window=7d\|30d\|90d`, default `30d`) | `SkillStats` | 404 · 422 (window outside the enum) |

Notes:

- `runs_30d` and `latest_verdict` are computed in the same list query (no N+1).
  The server always sends both. `latest_verdict: null` means "no evals".
  They are optional in the schema only so older payloads still parse.
- `latest_verdict` comes from the latest **Full** suite with status `done` that
  covers the whole case set (per-case suites, `case_ids` set, are ignored).
  `stale` is true when the skill's current `prompt_sha256 = sha256(name + body)`
  or the carrier's version differs from the one the suite ran on.
- Stats count only runs with `agent_runs.status = 'completed'`. Runs without
  `run_skills` rows are skipped, not treated as errors.
- `usage.agents` lists every agent that links the skill, with its
  `SkillAgentUsageStatus` and runs in the window. The client derives the
  default eval carrier from this list (the agent with the most runs).
- `cost.cost_source` is `estimated` (skill tokens × model price). When no model
  in the window has a price, `cost_usd` and `cost_source` are both null.
- `impact` is null until a whole-skill suite exists (Phase 3); per-case suites never fill it.

## Phase 3: Evals

### Cases

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/skills/:id/eval-cases` | none | `SkillEvalCase[]` | 404 |
| POST | `/skills/:id/eval-cases` | `CreateEvalCaseBody` | 201 `SkillEvalCase` | 404 (skill or `pr_id`) · 422 `validation_error` (see below) · 422 `eval_case_file_not_in_pr` |
| PUT | `/eval-cases/:id` | `UpdateEvalCaseBody` | `SkillEvalCase` | 404 · 422 `validation_error` (see below) · 422 `eval_case_file_not_in_pr` |
| DELETE | `/eval-cases/:id` | none | `{ ok: true }` | 404 |
| GET | `/skills/:id/eval-cases/latest-results` | none | `EvalCaseLatestResult[]` (the eval cards) | 404 (skill) · 422 (bad id) |
| GET | `/eval-cases/:id` | `EvalCaseDetailQuery` (`?suite_id=` optional uuid) | `EvalCaseDetail` (the eval drawer) | 404 (case, suite, or a suite that has no run of the case) · 422 (`suite_id` not a uuid) |

- `source.kind = 'paste'` stores the diff as given. `source.kind = 'pr'` builds
  a unified diff from the listed files' patches of a synced PR. Either way the
  diff is snapshotted into `input_diff`, so later PR updates do not change the
  case. `input_source` echoes the provenance without the diff.
- `expectation` is `EvalExpectation` (`.strict()`): a defect case has
  `must_find` and no `must_not_find`, a clean case has the reverse. `contains`
  is a case-insensitive substring and never a regex.
- A legacy row whose `expected_output` does not parse comes back with
  `expectation: null`. Suites skip such rows.
- 422 `validation_error` beyond the route schema (name, `notes`, diff length,
  `files` 1-50, strict keys, the defect/clean expectation rules):
  - a pasted diff that parses to zero file changes (`details.field = "source.diff"`);
  - a PR-built diff over `EVAL_CASE_DIFF_MAX` (200,000 chars), the same cap as a
    pasted diff (`details: { field: "source.files", chars }`);
  - an expectation naming a file that is not in the case diff
    (`details: { field: "expectation", files }`). On PUT this is re-checked
    whenever the expectation or the source changes.

### Suites

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/skills/:id/eval-carriers` | none | `EvalCarrier[]`, default first | 404 |
| GET | `/skills/:id/eval-suites` | none | `EvalSuite[]`, newest first | 404 |
| POST | `/skills/:id/eval-suites` | `CreateEvalSuiteBody` (`carrier_agent_id` optional on the server; optional `case_ids`) | 201 `EvalSuite` (`status: 'estimated'`) | 404 (skill or carrier) · 409 `eval_skill_not_vetted` · 422 `eval_no_carrier` · 422 `eval_carrier_not_linked` · 422 `eval_no_cases` · 422 `eval_case_not_found` · 422 `eval_price_unknown` · 422 `eval_too_many_jobs` · 422 `eval_budget_exceeded` |
| POST | `/eval-suites/:id/start` | none (body-less) | `EvalSuite` | 404 · 409 `eval_suite_busy` · 409 `eval_suite_stale` |
| POST | `/eval-suites/:id/cancel` | none (body-less) | `EvalSuite` | 404 |
| GET | `/eval-suites/:id` | none | `EvalSuiteDetail` | 404 |

- Carriers (2026-09-29): a carrier is an agent that links the skill with the
  link enabled (`agent_skills.enabled`). `GET /skills/:id/eval-carriers` returns
  `{ agent_id, agent_name, runs, is_default }[]`, most completed runs with the
  skill first, ties by name, and exactly the first row has `is_default: true`.
  The list is empty when no agent qualifies. The skill's own `enabled` flag is
  not part of eligibility (ADR 0018 amendment).
- `carrier_agent_id` is optional in the request (the wire contract requires it;
  the server accepts a superset):
  - Omitted: the default carrier above is used. None eligible is 422
    `eval_no_carrier`.
  - Given but not an eligible carrier (unlinked, or link disabled): 422
    `eval_carrier_not_linked` with `details: { carrier_agent_id }`.
  - Given but no such agent in the workspace: 404.
- Create estimates the suite and runs nothing:
  - `repeats = EVAL_REPEATS[mode]`, `total_jobs = cases × 2 × repeats`.
  - More than `EVAL_MAX_JOBS_PER_SUITE` (150) jobs is 422 `eval_too_many_jobs`.
  - An estimate above `EVAL_MAX_BUDGET_USD` is 422 `eval_budget_exceeded`.
  - A carrier model with no price is 422 `eval_price_unknown`, because no
    estimate can be made.
- Trust gate (ADR 0012) is 409 `eval_skill_not_vetted`. It fires when
  `source ≠ 'manual'` and `vetted_body_hash ≠ sha256(body of the target version)`.
- Start runs `UPDATE … WHERE status = 'estimated' AND workspace_id = $ws`:
  - Calling it on a suite that is already past `estimated` returns 200 with
    the current state and starts nothing.
  - 409 `eval_suite_busy` when another suite in the workspace is `running`.
  - 409 `eval_suite_stale` when the skill's `prompt_sha256` or the carrier's
    version moved since the estimate. The client then creates a new suite.
- Cancel on a terminal suite is a 200 no-op. The runner checks for
  cancellation between chunks, and an LLM call already in flight still finishes
  and is still billed.
- Polling target: `GET /eval-suites/:id`, every 2 s while `status` is not in
  `EVAL_SUITE_TERMINAL_STATUSES`. On a terminal status the client invalidates
  `skill-stats` and `skill`.
- `EvalSuiteResults.errored` (additive; absent on older rows, parsed as 0)
  counts cases where any run failed (timeout, provider error, cancel). They are
  excluded from `passing`, `total`, `caught`, `regressed`, `flaky`,
  `delta_unexpected` and the verdict, so an error never reads as a failure.
  `passing / total` are over settled cases (not errored, not pending).
- The per-job timeout is derived from the adapters' worst case for one model
  call (`worstCaseCallMs` in `evals/domain.ts`), not a fixed guess. A timed-out
  run is stored as `failed` with the timeout message and counts as `errored`.
- Verdict (ADR 0017): only a Full suite (3 repeats) can return
  `helps`/`neutral`/`hurts`. A Quick suite always returns `indicative`, and so
  does any suite with fewer than 5 non-flaky cases. `results` stays null until
  `done`.
- Per-case run (2026-09-29, the card's run button): `case_ids` is an optional
  array of 1..`EVAL_CASE_IDS_MAX` (50) uuids on `CreateEvalSuiteBody`. It is the
  same estimate → start flow, so the trust gate, the budget, the job cap, the
  one-running-suite rule and the idempotent start all apply unchanged.
  - Every id must be a **runnable** case of the skill (parseable expectation).
    An id that is unknown, belongs to another skill or is a legacy row is 422
    `eval_case_not_found` with `details: { case_ids: [...missing] }`, and nothing
    is stored. Duplicates collapse to one; list order is the skill's case order.
  - `total_jobs`, the runs and `estimate_usd` cover the subset only.
  - The subset is stored on `eval_suites.case_ids` (`uuid[]`, migration 0021;
    NULL = the whole runnable set). `EvalSuite.case_ids` echoes it and
    `EvalSuite.partial` is `case_ids !== null`. Both are optional in the schema
    so older payloads parse; the server always sends them.
  - A **partial suite is never a verdict source** (ADR 0017: a verdict needs the
    full case set). `GET /skills` `latest_verdict` and `GET /skills/:id/stats`
    `impact` ignore partial suites entirely, so a skill that only ever ran
    per-case suites has `latest_verdict: null` and `impact: null`. The partial
    suite's own `results.verdict` is always `indicative`, whatever its mode.
  - `GET /skills/:id/eval-suites` still lists partial suites (newest first);
    clients that want "the latest whole-skill run" filter on `partial`.
- `EvalSuiteCaseResult` gains four summary fields, derived from the runs and
  never stored (`eval_runs.expected/matched/unexpected` already hold the inputs):
  - `expected_count`: `must_find` size as the runs recorded it (0 = clean case),
    taken from a done `with` run, else a done `without` run.
  - `matched_median`: median over the `with` arm's **done** repeats of `matched`.
  - `unexpected_median`: same for `unexpected`.
  - `is_clean`: `expected_count === 0`.
  - `with_errored` (additive): how many `with`-arm repeats failed (timeout, provider
    error, cancel). The card reads it as "matched X · N errored" when some repeats
    scored and some did not.
  - All four are `null` until a run of the case is done (the card shows "never
    run"). An even count of repeats gives the mean of the two middle values, so
    a median can end in `.5`. Optional in the schema only for older payloads.
  - A `null` median means "no scored `with`-arm run", never 0. A client must not
    show "matched 0" for it: an errored case reads "run failed", a running one
    "running…".
- `EvalSuite.cost_source` holds the single source of its runs. There is one
  carrier and therefore one provider, so a suite never mixes sources.

### Latest result per case (the cards)

`GET /skills/:id/eval-cases/latest-results` returns `EvalCaseLatestResult[]`, one
row per case of the skill that has a settled run, in the skill's case order:

```
{ case_id, suite_id, suite_partial, suite_created_at, outcome, with, without,
  expected_count, matched_median, unexpected_median, is_clean, with_errored, stale }
```

- The row comes from the most recent **terminal** suite (`done`, `failed` or
  `cancelled`; whole or per-case, ordered by `finished_at`, else `created_at`)
  that settled at least one run of the case. A **settled** run is `done`, or
  `failed` for a real reason. A run failed only because its suite was cancelled
  never executed, so a cancelled suite that ran nothing of the case does not
  replace the earlier result. Running and `estimated` suites are not included;
  the client shows a running suite's progress from `GET /skills/:id/eval-suites`.
- The figures are the suite table's (`classifyCase` + the per-case summary over
  that suite's runs of the case), so `outcome`, medians and `with_errored` mean
  exactly what they do in `EvalSuiteCaseResult`. A case that never settled a run
  has no row ("never run").
- Cost: two queries, no N+1. `SELECT DISTINCT ON (case_id) … ORDER BY case_id,
  COALESCE(suite.finished_at, suite.created_at) DESC` over `eval_runs` joined to the
  skill's suites (`eval_suites_skill_created_idx`, then `eval_runs_suite_status_idx`;
  `EXPLAIN` shows no seq scan, so no new index), then one fetch of those suites' runs.
- Verdict semantics are unchanged: the header badge, the summary line, `latest_verdict`
  and `impact` still read only the latest **whole** suite. Only the cards use this endpoint.
- Client cache key: `["skill-eval-latest", skillId]`, invalidated whenever a suite
  reaches a terminal status (with the suites list) and after a case is deleted.

### Case detail (the drawer)

`GET /eval-cases/:id?suite_id=` returns `EvalCaseDetail`. Workspace-scoped: a case
of another workspace, or a non-skill case, is 404.

```
{
  case:  { id, skill_id, name, notes, expectation, input_source, input_files,
           input_diff_preview, input_diff_chars, input_diff_truncated,
           created_at, updated_at },
  suite: { id, mode, status, carrier_name, skill_version, repeats, stale,
           partial, created_at } | null,
  arms:  { with: Arm, without: Arm },
  outcome: EvalCaseOutcome | null,
  expectation_changed: boolean,
  history: [{ suite_id, created_at, mode, outcome, skill_version, stale, partial }]
}
Arm = { passed, total, matched_median, unexpected_median, runs: Run[] }
Run = { repeat_idx, status, pass, matched_must_find: number[],
        missed_must_find: number[], unexpected, unexpected_findings: Finding[],
        duration_ms, cost_usd, cost_source, error }
Finding = { file, line, severity, category, title }
```

- Suite choice: `suite_id` given selects that suite (any status). It must be in
  the workspace and must contain a run of the case, else 404. Omitted, it is the
  latest **started** suite (status past `estimated`) that contains the case,
  partial ones included. A case that never ran has `suite: null`, both arms with
  `total: 0` and `runs: []`, `outcome: null` and `history: []`.
- `outcome` is `classifyCase` over the case's runs in that suite, the same
  function as the suite table. A suite still running reports `pending`; a failed
  run makes it `error`.
- `arms.*.passed/total` are the arm tally (`total` = the suite's repeats). The
  medians are over that arm's done repeats. Runs are ordered by `repeat_idx`.
- `matched_must_find` and `missed_must_find` are **indexes into
  `case.expectation.must_find`**, computed with the scoring matcher
  (`matchesMustFind`) over the findings stored in `eval_runs.actual_output`.
  Both are empty for a run that is not `done` and for a legacy case whose
  expectation does not parse. They are computed against the *current*
  expectation, so `expectation_changed` is true when `case.updated_at` is after
  the suite's `started_at` (or `created_at`); the UI should then say the
  indexes may not line up. Any edit to the case sets it, including a rename.
- `unexpected_findings` lists the findings that matched no `must_find` entry,
  most severe first, capped at `EVAL_CASE_UNEXPECTED_FINDINGS_MAX` (20).
  `unexpected` keeps the stored true count, so it can exceed the list length.
  Malformed entries in the stored jsonb are dropped, not an error.
- `case.input_diff_preview` is the first `EVAL_CASE_DIFF_PREVIEW_MAX` (4000)
  characters; `input_diff_chars` is the full size. The complete diff stays on
  `SkillEvalCase.input_diff` (`GET /skills/:id/eval-cases`).
- `history` is the last `EVAL_CASE_HISTORY_MAX` (10) started suites containing
  the case, newest first, each with the case's outcome in that suite. `stale`
  is the suite's own stale flag (skill prompt or carrier moved since).
- Cost is the run's own pair (ADR 0002): `cost_usd` and `cost_source` are both
  null or both set. A failed run has neither.

## Client cache keys touched

| Mutation | Invalidate |
|---|---|
| restore | `["skill", id]`, `["skill-versions", id]`, `["skill-stats", id]`, `["skills"]`, `["agent-skills"]` |
| PUT skill | as today, plus `["skill-versions", id]` |
| case create/update/delete | `["skill-eval-cases", id]`, and `["eval-case", caseId]` for the case detail |
| suite create/start/cancel | `["skill-eval-suites", id]`, `["eval-suite", suiteId]` |
| suite reaches terminal status | also `["eval-case", caseId]` for every case the suite covered |
| suite reaches terminal status | `["skill-stats", id]`, `["skill", id]`, `["skills"]` |
