# ADR 0018 — Eval suites run on a dedicated job runner with a two-step start and a hard budget

**Status:** accepted
**Date:** 2026-09-29
**Relates to:** ADR 0002 (cost provenance), ADR 0005 (onion layering), ADR 0012 (skill trust tiers), ADR 0017 (impact verdict)

## Context

A Full suite is `cases × 2 arms × 3 repeats` LLM calls, each costing real money. The runner must survive retries, restarts and concurrent workers without double-spending or leaving a suite half-open. Constraints in the current code:

- The LLM port has no `signal` (`vendor/shared/adapters.ts:58-73`), so an `AbortSignal` cannot reach the call.
- A timeout does not stop an LLM call already in flight (`resilience.ts:13-24`).
- Adapters already retry internally (`anthropic.ts:105`, `openrouter.ts:55`).
- Model price can be unknown (`pricing.ts:46-50`).
- ADR 0012 forbids sending an unvetted skill to a model.

## Decision

1. **Dedicated runner.** A separate `JobRunner`, `container.evalJobs` (`container.ts:88`), concurrency 2, `retries: 0`. `timeoutMs` is chunks × adapter timeout plus headroom. The module lives in `server/src/modules/evals/`, wired per `server/AGENTS.md:53-54`.
2. **Idempotency.** `eval_runs` has UNIQUE `(suite_id, case_id, arm, repeat_idx)`. Handlers upsert, so a retry or a late result never creates a duplicate row. The handler writes its own status; a late result that arrives after a timeout honestly becomes `done`.
3. **Atomic suite close.** In `finally`, every handler runs `UPDATE eval_suites SET done_jobs = done_jobs + 1 … RETURNING done_jobs, total_jobs`. The handler that sees `done_jobs = total_jobs` aggregates and sets `done`. Failed runs count as done jobs. No coordinator, so concurrency 2 is safe.
4. **Two-step start.** `POST /skills/:id/eval-suites` creates a suite with `status='estimated'` and returns the estimate. `POST /eval-suites/:id/start` runs `UPDATE … WHERE status='estimated' AND workspace_id=$ws`. A repeated start matches zero rows and does nothing, so no separate token is needed.
5. **Budget.**
   - `EVAL_MAX_BUDGET_USD` in `config.ts` caps a suite's estimate.
   - `cases × 2 × repeats ≤ 150` (Full on 25 cases).
   - One running suite per workspace.
   - Unknown model price makes the estimate impossible: 422, no suite starts.
6. **Trust gate.** Suite creation returns 409 when `source ≠ 'manual'` and `vetted_body_hash ≠ sha256(body of the target version)`. The UI shows "vet skill first".
7. **Cancellation.** Cooperative, through `checkCancelled` between chunks. No `AbortSignal`.
8. **Restart recovery.** On boot, `eval_runs.status='queued'` rows are re-enqueued and orphaned `running` rows become `failed`.
9. **Invocation.** `reviewPullRequest` (`reviewer-core/src/review/run.ts:144`) with the carrier's prompt. `with` = the agent's skills plus target at the pinned version; `without` = the same minus target.
10. **Progress.** Client polls `GET /eval-suites/:id` with `refetchInterval: q => terminal ? false : 2000` (precedent `hooks/reviews.ts:40-54`). On a terminal state it invalidates `skill-stats` and `skill`.
11. **Schema.** `eval_runs` gets nullable `workspace_id, suite_id, arm, repeat_idx, status, error, tokens_in/out, cost_source` (nullable so legacy rows migrate), with `CHECK ((cost_usd IS NULL) = (cost_source IS NULL))`. `eval_cases.skill_id` is a nullable FK with CASCADE and `CHECK (owner_kind='skill' ⇒ skill_id = owner_id)`. DML migrations use `drizzle-kit generate --custom`.

## Consequences

### What this enables

- Retries, restarts and parallel handlers cannot double-count or leave a suite open.
- Spend is bounded before it starts, and cost is shown with provenance.
- The trust boundary of ADR 0012 holds for evals as well.

### What this costs

- **Cancel and timeout do not stop spend.** A call already sent to the provider runs to completion and is billed. Cancel takes effect only at the next chunk boundary, and a timed-out call may still cost money and still land as `done`.
- Polling adds a request every 2 s while a suite runs, and progress is at most 2 s stale.
- Concurrency 2 and one suite per workspace make large suites slow.
- The estimate is an estimate. Actual cost may exceed it when adapters retry.
- Eval runs skip repo-intel context (ADR 0017).

### What this forbids

- Starting a suite without a stored estimate, or starting the same suite twice.
- Running a suite on an unvetted non-manual skill body.
- Starting when the model price is unknown.
- Closing a suite from anywhere except the atomic counter.
- Job-level retries on top of adapter retries.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Reuse the review job runner | No new wiring | Eval load would starve real reviews; different timeouts and retries |
| **Dedicated `evalJobs` runner (chosen)** | Isolated load and limits | One more runner to wire and monitor |
| Coordinator job that waits for all children | Simple close logic | Long-lived job; breaks on restart |
| **Atomic counter in `finally` (chosen)** | Stateless, restart-safe | Every handler must reach `finally`; boot recovery needed |
| One-step run (estimate and start together) | Fewer clicks | No cost confirmation; double-click double-spends |
| **Estimate, then conditional-`UPDATE` start (chosen)** | Confirms spend; idempotent | Extra request |
| Add `signal` to the LLM port now | True cancel, no wasted spend | Touches every adapter and the vendored contract; deferred |
| Job-level retries | Resilient to transient errors | Adapters already retry; double spend |
