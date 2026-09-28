/**
 * Skill bodies seeded for SPEC-02's control experiment. Each skill is source
 * `manual` (author-written, never `imported`) and workspace-scoped by the
 * caller (`seed.ts` fills in `workspaceId` at insert time).
 *
 * `description` is the skill's interface — written as "Use when… Flags…" per
 * ADR 0012 / specs/02-skills.md AC-6 — and is what a person picks a skill by
 * before ever reading the body. `body` is the directive markdown that
 * actually reaches the agent's prompt (specs/02-skills.md D5).
 *
 * These bodies intentionally carry the specific checklists (boundary values,
 * over-mocking shapes, breaking-change patterns) that the agent prompts in
 * `seed-prompts.ts` deliberately leave out — see the control experiment in
 * specs/02-skills-rubric.md: the "no skills" arm must have a real chance of
 * missing the seeded defect, which only holds if the prompt alone doesn't
 * already spell it out.
 */

export type SeedSkillType = 'rubric' | 'convention' | 'security' | 'custom';

export type SeedSkillDef = {
  name: string;
  description: string;
  type: SeedSkillType;
  body: string;
};

export const BRANCH_COVERAGE_GATE: SeedSkillDef = {
  name: 'branch-coverage-gate',
  description:
    "Use when reviewing a diff that adds or changes a conditional, error path, or early return. Flags any new branch (if/throw/early return/status code) that has no test exercising it.",
  type: 'rubric',
  body: `# Branch Coverage Gate

Use when a diff adds, removes, or changes an \`if\`, \`throw\`, early \`return\`,
guard clause, or a status-code branch (e.g. a validation check, an error
path, a feature-flag branch). Flags any new branch that the diff's own test
changes do not exercise.

## What to do

1. List every new or changed branch in the diff: each \`if\`/\`else\`, \`throw\`,
   early \`return\`, ternary that changes behavior, and switch case.
2. For each branch, look at the paired test file changes in the same diff.
   A branch counts as covered only when a test asserts the OUTCOME of that
   specific branch (the thrown error, the returned status, the different
   return value) — not merely that the function was called.
3. If the diff adds exactly one test and it exercises only the pre-existing
   "normal" path, the new branch is uncovered even though "a test was
   added." Adding a test is not the same as testing the new code.
4. Report each uncovered branch as its own finding, citing the exact file
   and line of the branch, and state in one sentence what input would
   exercise it and what the test file is missing.

## Severity guidance

- A new error-throwing branch (validation failure, guard clause) with zero
  test coverage is a WARNING at minimum — it ships unverified failure
  behavior.
- A new branch that changes a response shape or status code with no test is
  CRITICAL if it's reachable from an external client.

## What NOT to flag

- Pre-existing branches the diff didn't touch.
- Branches inside test helpers or fixtures.
- A branch guarded by a type system that makes the "untested" path
  unreachable (e.g. exhaustive union narrowing).`,
};

export const CORNER_CASE_CHECKLIST: SeedSkillDef = {
  name: 'corner-case-checklist',
  description:
    'Use when a diff adds a numeric comparison, a boundary condition, or an input that can be empty/zero/negative. Flags missing tests for the boundary value itself and for empty/zero/negative inputs.',
  type: 'rubric',
  body: `# Corner-Case Checklist

Use when a diff introduces or edits a numeric comparison (\`>\`, \`<\`, \`>=\`,
\`<=\`, \`===\`), a length/size check, or any validation on user-supplied
input. Flags missing tests for the values right at and around the boundary.

## Checklist to run against every new comparison

For a comparison shaped \`a > b\`, \`a >= b\`, \`a < b\`, or \`a <= b\`, three
values matter: the value just below the boundary, the value exactly AT the
boundary, and the value just above it. A single happy-path test almost
always covers none of these three.

- **Equality boundary**: if the code compares \`amount > captured\`, is there
  a test for \`amount === captured\`? The comparison operator (\`>\` vs \`>=\`)
  decides whether the equal case passes or fails — that is exactly the bug
  a boundary test catches.
- **Zero and negative**: for any numeric input that reaches a calculation, a
  database write, or an external API, is there a test for \`0\` and for a
  negative value? Absence of a lower-bound check is itself a finding.
- **Empty collection**: for any input that is a list, string, or object, is
  there a test for the empty case (\`[]\`, \`''\`, \`{}\`)?

## Reporting

State the exact operator and the specific boundary value with no test
covering it (e.g. "\`amount > payment.captured\` has no test for
\`amount === payment.captured\`"). Do not report a general "add more tests"
finding — name the missing value.

## What NOT to flag

Boundaries already covered by an existing test in the same file, and
boundaries on values the type system already makes unreachable (e.g. an
unsigned integer type where negative cannot occur).`,
};

export const MOCK_DISCIPLINE: SeedSkillDef = {
  name: 'mock-discipline',
  description:
    'Use when a diff adds or edits a test file. Flags mocks that replace the behavior under test instead of an external dependency, and assertions that only check a mock was called.',
  type: 'convention',
  body: `# Mock Discipline

Use when a diff touches a \`*.test.ts\` file. Flags over-mocking: a mock that
stands in for the logic actually being tested, rather than for an external
boundary (network, filesystem, clock, RNG, a different module).

## Signals of over-mocking

- The test mocks the SAME function or module whose behavior the test claims
  to verify (e.g. mocking \`refundsRepo.create\` and then asserting only
  that it was called with certain args, never checking what the function
  under test actually returned or threw).
- A mock's return value is hardcoded to make the assertion trivially pass,
  so the test would still pass if the implementation were deleted.
- \`expect(mock).toHaveBeenCalled()\` / \`toHaveBeenCalledWith(...)\` is the
  ONLY assertion in the test — verifying a call happened is not the same as
  verifying the code under test behaved correctly.
- Mocking an in-process pure function instead of letting it run for real.
  Only mock true I/O boundaries: network calls, the database client,
  \`Date.now\`, \`Math.random\`, filesystem, child processes.

## What to report

For each over-mocked test, name what was mocked, why it should not have
been (it's not an I/O boundary), and what real assertion is missing (the
actual return value, the actual thrown error, the actual persisted state).

## What NOT to flag

Mocking genuine I/O boundaries (HTTP clients, the DB driver, external SDKs)
is correct practice, not over-mocking. A mock combined with an assertion on
the function's real return value or thrown error is not a finding.`,
};

export const FLAKY_TEST_PATTERNS: SeedSkillDef = {
  name: 'flaky-test-patterns',
  description:
    'Use when a diff adds or edits a test. Flags patterns that make a test non-deterministic: unmocked time, unmocked randomness, order-dependent assertions, or a real network call.',
  type: 'convention',
  body: `# Flaky Test Patterns

Use when a diff adds or edits a test file. Flags patterns that make a test
pass or fail depending on when, in what order, or how fast it runs, rather
than on the code's actual correctness.

## Patterns to flag

- **Unmocked time**: \`Date.now()\`, \`new Date()\`, or a TTL/expiry check
  exercised without freezing the clock. A test that passes today and fails
  a year from now (or at midnight, or across a timezone) is a finding.
- **Unmocked randomness**: \`Math.random()\`, a UUID generator, or any
  non-deterministic id used in an assertion instead of a fixture value.
- **Order-dependent assertions**: asserting on array order from a query or
  operation with no explicit \`ORDER BY\` / \`.sort()\` in the code under test
  — the database or runtime does not guarantee that order.
- **Real network or timers in a unit test**: an unmocked \`fetch\`/\`axios\`
  call, or a real \`setTimeout\`/\`setInterval\` awaited instead of using fake
  timers — both make the suite slow and dependent on an external service
  being up.
- **Shared mutable state across tests**: a module-level variable, in-memory
  array, or singleton mutated by one test and read by another with no reset
  in \`beforeEach\`.

## Reporting

Name the exact non-deterministic source and the concrete failure mode (what
has to happen for the test to flip), and suggest the deterministic fix
(fake timers, a seeded RNG, an explicit sort, \`beforeEach\` reset).

## What NOT to flag

Integration tests already isolated with testcontainers-per-run, or timers
already faked with \`vi.useFakeTimers()\`.`,
};

export const ROUTE_SIGNATURE_DIFF: SeedSkillDef = {
  name: 'route-signature-diff',
  description:
    'Use when a diff changes an HTTP route path, request/response schema, or status code. Flags a breaking change with no version bump or deprecation path.',
  type: 'rubric',
  body: `# Route Signature Diff

Use when a diff changes an HTTP route's path, path parameters, request
schema, response schema, or status codes. Flags any change an existing
client would experience as a break, and checks whether the diff adds
versioning or a deprecation path for it.

## What counts as a breaking change

- **Path or param rename**: \`/payments/:id\` → \`/payments/:paymentId\` breaks
  any client building the URL from the old param name, and any server code
  reading \`req.params.id\` that was not updated alongside the route.
- **A previously optional field becomes required**: a request field that had
  a default (e.g. \`currency\` defaulting to \`'USD'\`) now failing validation
  when omitted. Existing callers that relied on the default now get a 4xx
  they didn't get before.
- **Response field rename**: \`amount_cents\` → \`amountCents\` (or any
  snake_case ↔ camelCase change, or a field removed/renamed) breaks any
  client parsing the old key.
- **Response shape change**: an array response becoming \`{ items, ... }\`
  (or vice versa) breaks every client that iterated the old shape directly.
- **Status code change**: a success path that used to return 200 now
  returning 201/204, or a new 4xx introduced for a previously-accepted
  input.

## What to check for each breaking change found

State the exact old and new shape/signature, and confirm whether the diff
includes: a new API version segment or header, a deprecation notice on the
old shape, or a transition period (both fields accepted). If none of these
is present, report it as a breaking change with no migration path —
CRITICAL when the route has no version prefix already visible in the diff
or surrounding file.

## What NOT to flag

An additive change (new optional field, new route, new optional query
param) is not breaking. A field rename inside a request/response type that
is not yet exposed over HTTP is not breaking.`,
};

/** Linked to Test Quality Reviewer, in this order (specs/02-skills.md D1). */
export const TEST_QUALITY_SKILLS: SeedSkillDef[] = [
  BRANCH_COVERAGE_GATE,
  CORNER_CASE_CHECKLIST,
  MOCK_DISCIPLINE,
  FLAKY_TEST_PATTERNS,
];

/** Linked to API Contract Reviewer. */
export const API_CONTRACT_SKILLS: SeedSkillDef[] = [ROUTE_SIGNATURE_DIFF];
