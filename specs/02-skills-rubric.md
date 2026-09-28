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
