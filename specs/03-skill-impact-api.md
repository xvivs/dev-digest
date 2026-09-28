# Spec: Skill impact API (versions, stats, evals)

**Status:** contracts landed, endpoints not built · **Branch:** `feat/skill-impact`

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
- `latest_verdict` comes from the latest **Full** suite with status `done`.
  `stale` is true when the skill's current `prompt_sha256 = sha256(name + body)`
  or the carrier's version differs from the one the suite ran on.
- Stats count only runs with `agent_runs.status = 'completed'`. Runs without
  `run_skills` rows are skipped, not treated as errors.
- `usage.agents` lists every agent that links the skill, with its
  `SkillAgentUsageStatus` and runs in the window. The client derives the
  default eval carrier from this list (the agent with the most runs).
- `cost.cost_source` is `estimated` (skill tokens × model price). When no model
  in the window has a price, `cost_usd` and `cost_source` are both null.
- `impact` is always null until Phase 3 ships.

## Phase 3: Evals

### Cases

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/skills/:id/eval-cases` | none | `SkillEvalCase[]` | 404 |
| POST | `/skills/:id/eval-cases` | `CreateEvalCaseBody` | 201 `SkillEvalCase` | 404 (skill or `pr_id`) · 422 · 422 `eval_case_file_not_in_pr` |
| PUT | `/eval-cases/:id` | `UpdateEvalCaseBody` | `SkillEvalCase` | 404 · 422 · 422 `eval_case_file_not_in_pr` |
| DELETE | `/eval-cases/:id` | none | `{ ok: true }` | 404 |

- `source.kind = 'paste'` stores the diff as given. `source.kind = 'pr'` builds
  a unified diff from the listed files' patches of a synced PR. Either way the
  diff is snapshotted into `input_diff`, so later PR updates do not change the
  case. `input_source` echoes the provenance without the diff.
- `expectation` is `EvalExpectation` (`.strict()`): a defect case has
  `must_find` and no `must_not_find`, a clean case has the reverse. `contains`
  is a case-insensitive substring and never a regex.
- A legacy row whose `expected_output` does not parse comes back with
  `expectation: null`. Suites skip such rows.

### Suites

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/skills/:id/eval-suites` | none | `EvalSuite[]`, newest first | 404 |
| POST | `/skills/:id/eval-suites` | `CreateEvalSuiteBody` | 201 `EvalSuite` (`status: 'estimated'`) | 404 (skill or carrier) · 409 `eval_skill_not_vetted` · 422 `eval_no_cases` · 422 `eval_price_unknown` · 422 `eval_too_many_jobs` · 422 `eval_budget_exceeded` |
| POST | `/eval-suites/:id/start` | none (body-less) | `EvalSuite` | 404 · 409 `eval_suite_busy` · 409 `eval_suite_stale` |
| POST | `/eval-suites/:id/cancel` | none (body-less) | `EvalSuite` | 404 |
| GET | `/eval-suites/:id` | none | `EvalSuiteDetail` | 404 |

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
- Verdict (ADR 0017): only a Full suite (3 repeats) can return
  `helps`/`neutral`/`hurts`. A Quick suite always returns `indicative`, and so
  does any suite with fewer than 5 non-flaky cases. `results` stays null until
  `done`.
- `EvalSuite.cost_source` holds the single source of its runs. There is one
  carrier and therefore one provider, so a suite never mixes sources.

## Client cache keys touched

| Mutation | Invalidate |
|---|---|
| restore | `["skill", id]`, `["skill-versions", id]`, `["skill-stats", id]`, `["skills"]`, `["agent-skills"]` |
| PUT skill | as today, plus `["skill-versions", id]` |
| case create/update/delete | `["skill-eval-cases", id]` |
| suite create/start/cancel | `["skill-eval-suites", id]`, `["eval-suite", suiteId]` |
| suite reaches terminal status | `["skill-stats", id]`, `["skill", id]`, `["skills"]` |
