# API Contract experiment: protocol and rubric

Written before any run (`specs/02-conventions.md` § Control experiment, D14, AC-49 to AC-53).
It extends `specs/02-skills-rubric.md`, which stays authoritative for the arm mechanics
and the `prompt_assembly` check. The rubric below is frozen before the first run and is not
edited to fit a result.

## Why this rerun exists

In SPEC-02 the API arm did not reproduce: the no-skills arm flagged the breaking change in
3/3 runs (`specs/02-skills-rubric.md` § Results). The seeded diff was a visible route and
schema edit, and the agent's role alone was enough. This PR hides the breakages where a
generic prompt is least likely to look: a mapper outside the route file, a schema flip with
no route edit, an enum in a shared contract, and a deletion that leaves the types compiling.

## Conditions

| | A (control) | B (treatment) |
|---|---|---|
| Agent | API Contract Reviewer, generic prompt, unchanged | same agent, same prompt |
| Skills | all links `enabled: false` (`skills` block empty) | 4 links enabled: `api-breaking-change`, `response-schema`, `semver-discipline`, `deprecation-policy` |
| PR | `demo/api-breaking-change` vs `main`, never merged | same PR |
| Model, provider, temperature, strategy | identical, recorded once below | identical |
| Runs | 3 | 3 |

Setup order: import `fixtures/skills/api-breaking-change` through the Import drawer (arrives
disabled and unvetted, AC-50), import or create the three skills from `skills/`, vet all
that need it, link the four to the agent, then toggle via `PUT /agents/:id/skills`. Use an
isolated database, as in SPEC-02.

Record before run 1: model id, provider, temperature (set explicitly, not left to default),
strategy, agent version id, PR head SHA, date.

## Rubric

### Hit definition

A finding is a **hit** for a breakage only if it has all three elements:

1. **Location.** Cites `file:line` inside the frozen range for that breakage (table below).
2. **Client impact.** States what an existing caller sees: a missing key, a new 4xx, an
   unhandled enum value. "Breaking change" alone is not impact.
3. **Path.** Names a major-version bump or a deprecation path (dual-write, `@deprecated`,
   `Sunset`). "Be careful" is not a path.

Missing element 1 only: **semantic hit** (reported separately, see Scoring). Missing 2 or 3:
**partial**, counted as a miss for the strict score. No finding on that breakage: **miss**.
The pre-change SPEC-02 result showed line citations are noisy, so both scorings are reported
and neither replaces the other.

### The four breakages

| ID | Breakage | Hit needs (beyond the three elements) |
|---|---|---|
| B1 | DTO field rename in the mapper, outside `routes.ts` | Names both old and new key; says the route file is unchanged so the rename is easy to miss |
| B2 | Request field optional to required | Says a request that omitted the field now gets 400 |
| B3 | Enum narrowing in a shared contract | Names the removed member; says clients handling it now see an unknown value or a parse failure |
| B4 | Silent removal of a response field, no `@deprecated` | Says the key is gone from the wire and no deprecation window existed |

Cross-cutting element (scored, not a separate hit): whether the run notes that
`package.json` version is unchanged and there is no changelog entry.

Frozen file:line ranges are filled from the final `demo/api-breaking-change` diff (new-side
lines, derived with `parseUnifiedDiff`), before run 1:

| ID | Range (new side) | Frozen on |
|---|---|---|
| B1 | `server/src/modules/reviews/helpers.ts:12-14` (type), `:42-43` (mapper); `server/src/vendor/shared/contracts/review-api.ts:15-17` and `client/src/vendor/shared/contracts/review-api.ts:15-17` | 2026-09-29 |
| B2 | `server/src/modules/agents/routes.ts:40` | 2026-09-29 |
| B3 | `server/src/vendor/shared/contracts/findings.ts:11`; `client/src/vendor/shared/contracts/findings.ts:11` | 2026-09-29 |
| B4 | `server/src/modules/reviews/helpers.ts:24-25` (`ReviewDto`, deletion point between `run_id` and `kind`), `:56-62` (`reviewToDto`, deletion point in the returned object between `:61` and `:62`); `server/src/modules/reviews/service.ts:164` (call site) | 2026-09-29 |

### False positives

A finding that is not one of B1 to B4 and is not a real defect in the diff: additive change
called breaking, a file the PR did not touch, a style remark. Findings that are true but
outside B1 to B4 (for example the missing version bump) are logged as **extra valid**, not as
false positives. Count both.

## Scoring

Per run: hits out of 4 (strict), hits out of 4 (semantic), false positives, extra valid.
Per condition: mean and per-breakage count out of 3.

The experiment shows a delta if B beats A by at least one breakage in mean strict hits and
the per-breakage counts move in the same direction on at least two of the four. Anything
less is reported as not reproduced. AC-52 is met when A scores a miss or a partial on the
breakages the skills target in all three runs; if A hits them, that is the result.

## What to record

Per run, in `results.md`: run id (first 8 chars of `agent_runs.id`), hit or miss for each of
B1 to B4 (strict and semantic), false positives, extra valid, `skills_tokens`, `tokens_in`,
cost in USD and its `cost_source`, model reply latency if shown. Keep raw traces outside the
repo.

## Control check (prompt_assembly)

Same mechanics as `specs/02-skills-rubric.md` § Results. For run 1 of each condition, dump
both `prompt_assembly` records and confirm:

- user messages are byte-identical;
- system messages differ only inside the `<skills>` block;
- condition A `skills` block is empty and `skills_tokens` is 0;
- condition B lists all four skills in the RunTraceDrawer (AC-51);
- `tokens_in(B) - tokens_in(A)` is within about 10% of `skills_tokens`.

If any check fails, the pair is void and is rerun, and the failure is stated in the results.

## Breakage catalogue for `demo/api-breaking-change`

Branch from `main` on the DevDigest fork, never merge, no version bump, no changelog. Line
numbers are from the working tree when this protocol was written and may shift; re-check
before editing. The branch author makes the changes, not this document.

| ID | `path:line` | Change | Skill expected to catch it |
|---|---|---|---|
| B1 | `server/src/modules/reviews/helpers.ts:41-42` | In `findingRowToDto`, emit `line_start` / `line_end` instead of `start_line` / `end_line`, and update the `Finding` mapping type to match. `routes.ts` is untouched. Client reader: `FindingCard.tsx:51` | `response-schema`, then `api-breaking-change` |
| B2 | `server/src/modules/agents/routes.ts:40` | In `CreateAgentBody`, change `strategy: ReviewStrategy.optional()` to `strategy: ReviewStrategy`. Client type keeps it optional (`client/src/lib/hooks/agents.ts:38`) | `api-breaking-change` (optional to required), `semver-discipline` |
| B3 | `server/src/vendor/shared/contracts/findings.ts:11` | Remove `'SUGGESTION'` from `Severity`. Change `client/src/vendor/shared/contracts/findings.ts:11` too, or the vendored copies drift (AGENTS.md). Client reader: `PrDetailView/constants.ts:17` | `response-schema` |
| B4 | `server/src/modules/reviews/helpers.ts:65` (and `:23`) | Delete `agent_name` from `reviewToDto` output and the `ReviewDto` interface, no `@deprecated`. Client readers: `RunHistory.tsx:136`, `ReviewRunAccordion.tsx:65`, both fall back silently | `deprecation-policy`, then `semver-discipline` |

Notes for the author: keep the diff otherwise clean so false positives stay countable; do
not mention the breakages in the PR title or description; B1 and B4 share a file on purpose
(one mapper, two failure modes), keep the hunks apart.
