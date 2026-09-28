# SPEC-02 control-experiment rubric

Written before any run, per `specs/02-skills.md` § Control experiment: *"The
experiment is written down before it runs, so the result cannot shape the
rubric."* Line numbers below are the NEW-side numbers `parseUnifiedDiff`
derives from the exact `pr_files.patch` hunks seeded in `server/src/db/seed.ts`
— re-verified against those hunks, not re-derived from a rendered diff view.

Protocol (from `specs/02-skills.md`): same agent/model/strategy in both arms.
**Arm A** — the agent's skill links exist but are unlinked/disabled (skills
column empty in `prompt_assembly`). **Arm B** — the agent's linked skills are
enabled. Three runs per arm per PR. Diff the two `prompt_assembly` records per
run pair and confirm only the skills block differs.

---

## PR #490 — "Add refund amount validation"

**Agent:** Test Quality Reviewer
**Skills in Arm B:** `branch-coverage-gate`, `corner-case-checklist`,
`mock-discipline`, `flaky-test-patterns` (order 0-3, all enabled)

**Seeded defect:** `src/refunds/service.ts` adds
`if (amount > payment.captured) throw new RefundError('exceeds_captured')`
(new lines 6-8) before the existing create-and-return path (new lines 10-16).
`src/refunds/service.test.ts` (new file) adds exactly one test, and it only
calls `createRefund` with `amount = 2000 < captured = 5000` — the pre-existing
happy path.

**Expected finding(s):**

| # | Finding | File : line | Source skill |
|---|---|---|---|
| 1 | New `if (amount > payment.captured)` branch (the throw) has no test exercising it | `src/refunds/service.ts:6-8` | `branch-coverage-gate` |
| 2 | No test for the boundary `amount === payment.captured` (the operator is `>`, so equality takes the untested branch) | `src/refunds/service.ts:6` | `corner-case-checklist` |
| 3 (optional, not required for a hit) | No test for `amount` = `0` or negative | `src/refunds/service.ts:6` | `corner-case-checklist` |

**Counts as a HIT:** the run's findings include #1 (the uncovered throw
branch) **or** #2 (the untested equality boundary), citing
`src/refunds/service.ts` at a line inside 6-8, with a rationale that names
either "no test throws/exceeds_captured" or "no test at amount ==
captured". Either one alone is sufficient — they are two framings of the same
gap `branch-coverage-gate` and `corner-case-checklist` were each written to
catch, and a strong finding may report both merged into one.

**Counts as a MISS:** the run approves the PR, or every finding it reports is
about a file/line outside `src/refunds/service.ts:6-8`, or a finding
mentions "add more tests" without naming the throw branch or the equality
boundary specifically.

**Counts as a FALSE POSITIVE:** any finding NOT about the untested branch or
boundary above — e.g. a style nit on the new `if`, a claim about a bug in the
*existing* create-and-return path (unchanged by this diff), or a finding
about a file this PR didn't touch.

---

## PR #491 — "Use paymentId route param and require currency"

**Agent:** API Contract Reviewer
**Skills in Arm B:** `route-signature-diff` (order 0, enabled)

**Seeded defects (three, all in `src/api/payments.ts`):**

| # | Finding | File : line | Old → new |
|---|---|---|---|
| 1 | Required `currency` (was optional, defaulted to `'USD'`) | `src/api/payments.ts:7` | `z.string().length(3).default('USD')` → `z.string().length(3)` |
| 2 | Route param renamed | `src/api/payments.ts:11-12` | `/payments/:id` → `/payments/:paymentId`, `req.params.id` → `req.params.paymentId` |
| 3 | Response field renamed (both handlers) | `src/api/payments.ts:15` and `:26` | `amount_cents` → `amountCents` |

None of the three has a version bump, a deprecation notice, or a
dual-accepting transition in this diff.

**Counts as a HIT:** the run reports **at least one** of the three findings
above as a breaking change, citing `src/api/payments.ts` at a line inside
7, 11-12, 15, or 26, AND its rationale or a companion finding notes the
absence of versioning/deprecation (the "no migration path" half of
`route-signature-diff` — a finding that only names the rename with no comment
on migration safety still counts, since the skill's own reporting template
treats "no migration path" as the default state to call out, not an
additional fact to separately prove).

**Counts as a MISS:** the run approves the PR, or reports only style/clarity
findings unrelated to the three contract changes, or reports a finding about
a file other than `src/api/payments.ts`.

**Counts as a FALSE POSITIVE:** a claim that an *additive* change is
breaking (there are none in this diff), a claim about a route this PR didn't
touch, or a "breaking change" finding whose cited line is not one of
7, 11, 12, 15, 26.

---

## PR #492 (held-out) — "Paginate list refunds"

**Agents:** both Test Quality Reviewer and API Contract Reviewer, each with
its own Arm A / Arm B pair — this PR was **not** used to write any skill's
checklist. It tests generalization: the same *classes* of finding
(uncovered branch / boundary, breaking contract change with no migration
path) on a defect neither skill was tuned against.

**Seeded defects, both in `src/api/refunds.ts`:**

| # | Finding | File : line | Applies to |
|---|---|---|---|
| 1 | `GET /refunds` response changes from a bare array to `{ items, next_cursor }` — breaking, no versioning | `src/api/refunds.ts:13-20` (esp. `:14` `items`, `:19` `next_cursor`) | API Contract Reviewer |
| 2 | New `if (!cursor.valid) return 400` branch has no test — `src/api/refunds.test.ts` (new file) only tests the first, valid-cursor page | `src/api/refunds.ts:8-10` | Test Quality Reviewer |

**Counts as a HIT (API Contract Reviewer):** a finding citing
`src/api/refunds.ts` at a line inside 13-20, naming the array→object
response-shape change as breaking, with no migration path.

**Counts as a HIT (Test Quality Reviewer):** a finding citing
`src/api/refunds.ts` at a line inside 8-10, naming the untested
invalid-cursor branch.

**Counts as a MISS / FALSE POSITIVE:** same criteria as #490/#491 above,
applied per agent — a miss is approval or an unrelated finding set; a false
positive is any reported issue not matching the seeded defect for that
agent, including one agent flagging the other's defect (e.g. API Contract
Reviewer commenting on missing test coverage — that's not a contract
finding and doesn't count toward its hit rate either way, but log it in the
false-positive count since it's still noise relative to what the skill
was written to find).

---

## Run table template

One copy per PR. Fill `hit` as **Y**/**N**, `fp` as the count of false
positives per this rubric (not the model's total findings count).

### PR #490 — Test Quality Reviewer

| Arm | Run | Hit | FP count | `skills_tokens` | `tokens_in` | Cost (USD) | Notes |
|---|---|---|---|---|---|---|---|
| A (skills off) | 1 | | | 0 | | | |
| A (skills off) | 2 | | | 0 | | | |
| A (skills off) | 3 | | | 0 | | | |
| B (skills on) | 1 | | | | | | |
| B (skills on) | 2 | | | | | | |
| B (skills on) | 3 | | | | | | |

### PR #491 — API Contract Reviewer

| Arm | Run | Hit | FP count | `skills_tokens` | `tokens_in` | Cost (USD) | Notes |
|---|---|---|---|---|---|---|---|
| A (skills off) | 1 | | | 0 | | | |
| A (skills off) | 2 | | | 0 | | | |
| A (skills off) | 3 | | | 0 | | | |
| B (skills on) | 1 | | | | | | |
| B (skills on) | 2 | | | | | | |
| B (skills on) | 3 | | | | | | |

### PR #492 (held-out) — Test Quality Reviewer

| Arm | Run | Hit | FP count | `skills_tokens` | `tokens_in` | Cost (USD) | Notes |
|---|---|---|---|---|---|---|---|
| A (skills off) | 1 | | | 0 | | | |
| A (skills off) | 2 | | | 0 | | | |
| A (skills off) | 3 | | | 0 | | | |
| B (skills on) | 1 | | | | | | |
| B (skills on) | 2 | | | | | | |
| B (skills on) | 3 | | | | | | |

### PR #492 (held-out) — API Contract Reviewer

| Arm | Run | Hit | FP count | `skills_tokens` | `tokens_in` | Cost (USD) | Notes |
|---|---|---|---|---|---|---|---|
| A (skills off) | 1 | | | 0 | | | |
| A (skills off) | 2 | | | 0 | | | |
| A (skills off) | 3 | | | 0 | | | |
| B (skills on) | 1 | | | | | | |
| B (skills on) | 2 | | | | | | |
| B (skills on) | 3 | | | | | | |

Report the result as measured (per `specs/02-skills.md` protocol step 5),
including a failure to reproduce — do not retro-fit this rubric's hit
criteria to whatever a run happened to say.

---

## Results — 2026-09-28 (measured)

Setup: isolated DB `devdigest_l02`, `openrouter/deepseek/deepseek-v4-flash`,
strategy single-pass, 3 runs per arm, arms toggled through
`PUT /agents/:id/skills` (arm A: every link `enabled:false`; arm B: seeded links
enabled). Raw traces kept outside the repo (run ids below resolve in that DB).

**Control check: passed.** For every PR/agent pair, arm A and arm B have a
byte-identical user message, and their system messages differ only by the
`<skills>` block (checked on run 1 of each arm).

Two scorings are reported because they disagree:

- **Strict**: the hit rules above, including "cited line inside the listed
  range".
- **Semantic**: the finding names the seeded defect, whatever line it cites.
  The model's line citations are noisy (it cites the test file's line 1, or
  the function's first line, instead of the branch), so the strict line rule
  mostly measures citation precision rather than detection.

| PR · agent | Arm | Strict hits | Semantic hits | What differs | FP (semantic) | tokens_in | `skills_tokens` | Avg cost |
|---|---|---|---|---|---|---|---|---|
| #490 · Test Quality | A | 0/3 | 3/3 uncovered branch · **0/3 boundary** | cites `service.test.ts:1` | 1 | 1447 | — | $0.00024 |
| #490 · Test Quality | B | 0/3 | 3/3 uncovered branch · **3/3 boundary `amount === captured`** | cites `service.ts:3-4` (source, not test) | 3 (one "unmocked repository" per run, from `mock-discipline`) | 3035 | 1653 | $0.00042 |
| #491 · API Contract | A | 2/3 | 3/3 (response rename + `currency` required) | — | 0 | 2689 | — | $0.00045 |
| #491 · API Contract | B | 3/3 | 3/3 (same two; run 1 also flags the rename on both endpoints) | — | 0 | 3645 | 1022 | $0.00059 |
| #492 · Test Quality (held-out) | A | 0/3 | 2/3 name the invalid-cursor gap, all on `refunds.test.ts:1` | — | 2 | 1603 | — | $0.00024 |
| #492 · Test Quality (held-out) | B | 2/3 | 3/3 name the invalid-cursor branch in `refunds.ts` | — | 4 | 3191 | 1653 | $0.00056 |
| #492 · API Contract (held-out) | A | 0/3 | 3/3 array→object breaking | — | 1 | 2829 | — | $0.00044 |
| #492 · API Contract (held-out) | B | 0/3 | 3/3 array→object breaking (run 1 also: new required `cursor`) | — | 0 | 3785 | 1022 | $0.00049 |

Run ids (first 8 chars of `agent_runs.id` in `devdigest_l02`):

| PR · agent | Arm | Run ids |
|---|---|---|
| #490 · Test Quality Reviewer | A | `f03c96dc` · `61846c68` · `d18033ba` |
| #490 · Test Quality Reviewer | B | `bacd200e` · `64cfe979` · `01ee298b` |
| #491 · API Contract Reviewer | A | `7330e9c7` · `d6b4387c` · `0f34c296` |
| #491 · API Contract Reviewer | B | `50defeda` · `35d959b9` · `cd611412` |
| #492 · Test Quality Reviewer | A | `20380dd0` · `5ad81344` · `d189b190` |
| #492 · Test Quality Reviewer | B | `c3d46145` · `dda79528` · `f5991aa5` |
| #492 · API Contract Reviewer | A | `eea48c07` · `f7a88ee7` · `d2971bdd` |
| #492 · API Contract Reviewer | B | `20258b3e` · `1c829198` · `11e0c078` |

### Reading

- **Test Quality, #490: reproduced, but not the way the spec phrased it.**
  Without skills the agent already reports the missing test for the throw
  branch (its own system prompt is about uncovered branches). What only the
  skills arm finds is the **boundary case** `amount === captured`: 0/3 → 3/3.
  The skills also move the citation from the test file to the source branch.
  Cost of that: +1588 input tokens and one extra mocking finding per run.
- **API Contract, #491: not reproduced.** Both arms flag the breaking changes
  in 3/3 runs. The seeded diff is too obvious for this model once the agent's
  role is "find breaking changes"; the skills add consistency (strict 2/3 →
  3/3) but no new detection. Nobody flagged `:id → :paymentId`: renaming a path
  parameter does not change the URL a client calls, so the models are right
  not to call it breaking and the rubric was wrong to expect it.
- **Held-out #492** mirrors the two above: the Test Quality skills sharpen the
  finding onto the invalid-cursor branch in source (strict 0/3 → 2/3); the API
  arm is saturated in both.
- **Token estimate:** `skills_tokens` (chars/4) predicted 1653 and 1022; the
  measured `tokens_in` delta was +1588 and +956, an overestimate of ~4-7% on
  English text.

**Verdict against the spec's control experiment:** reproduced on Test Quality
(boundary case appears only with skills), **not reproduced** on API Contract
(the no-skills arm does not miss). A harder API fixture, one where the
breaking change is subtle (for example a status code or an enum value
narrowing), is the next step if the API half must show a delta.
