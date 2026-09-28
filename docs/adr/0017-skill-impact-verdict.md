# ADR 0017 — "Did this skill help" is answered by ablation evals, not by usage

**Status:** accepted
**Date:** 2026-09-29
**Relates to:** ADR 0002 (cost provenance), ADR 0012 (skill trust tiers), ADR 0016 (skill versions)

## Context

Stats needs to say whether a skill helped an agent. The data we have does not say that:

- `findings` has no `skill_id`. Skill use is visible only in `run_traces.trace.skills_used` (jsonb, `run-executor.ts:348`).
- Every effective skill is injected into every run (resolution in `skills/repository.ts:216-249`, called from `run-executor.ts:124`). "Pull frequency" is therefore meaningless.
- Accept rate of findings compares different PRs and reflects human behaviour, not skill correctness.
- Asking the model to tag which skill produced a finding cannot be verified.

## Decision

1. **The only source of a verdict is an ablation eval.** A carrier agent runs each eval case twice, `with` the target skill and `without` it, with the same prompt and model.
2. **Cost is a denominator, not a verdict input.** `skills_used.tokens × runs` weighs benefit against price. Cost is shown as `cost_usd` with `cost_source='estimated'` (ADR 0002).
3. **Carrier.** One agent per suite, picked in the run modal. Default: the agent with the most runs that used the skill. The model is always the carrier's model.
4. **Modes.**
   - **Quick** = 1 repeat. Always "Indicative", never a verdict. Flaky detection needs repeats, so it does not run.
   - **Full** = 3 repeats per arm. Only Full produces a verdict.
5. **Per-case classification** (Full only):
   - **flaky**: the 3 repeats within one arm disagree. A flaky case is excluded from caught and regressed; the count is shown in the header.
   - **caught**: passes stably only with the skill.
   - **regressed**: passes stably only without the skill.
   - `Δunexpected` = mean unexpected findings with the skill minus without.
6. **Verdict rule.** Constants live in `evals/domain.ts`:
   - **Hurts** if `regressed > caught` or `Δunexpected > 2` per case.
   - **Helps** if `caught ≥ 1`, `regressed = 0` and `Δunexpected ≤ 1`.
   - Otherwise **Neutral**.
   - Fewer than 5 non-flaky cases gives **Indicative**. No suite has run: **Unknown**.
7. **Staleness key.** A verdict binds to `(prompt_sha256, carrier_agent_id, carrier_agent_version)`. `prompt_sha256 = sha256(name + body)`, which is what the model sees (`reviewer-core/src/skills.ts:10-12`). If any of the three changes, the UI shows "eval stale". We hash the prompt instead of using the version number because versions now bump on description and type edits (ADR 0016), and those must not invalidate an eval. The card shows the latest Full verdict and the carrier name.
8. **Scoring** is pure functions in `evals/domain.ts`: same file, lines within ±3, severity at least the expected one, matching category, optional `contains` substring. A case passes when every `must_find` matches and no `must_not_find` does.
9. **Rejected signals:** observational accept rate and LLM self-tagging. Neither is stored or shown in v1.

## Consequences

### What this enables

- A verdict that can be reproduced and falsified: same suite, same inputs, comparable arms.
- Skill edits that do not change the prompt keep their verdict.
- Cards read `3 agents · 142 runs · ✓ Helps` or `· no evals`.

### What this costs (validity limits)

- **One carrier.** A skill that helps agent A may hurt agent B. The verdict describes the carrier only.
- **No repo-intel context.** Eval runs skip the context real runs get (`run-executor.ts:222-230`), so results can differ in production.
- **Author-written expectations.** The verdict is only as good as the cases. Cases the author never thought of are invisible.
- **Temperature is not controlled.** `ReviewInput` cannot set it (`reviewer-core/src/review/run.ts:46-95`). Anthropic and OpenRouter adapters default to 0 (`anthropic.ts:112`, `openrouter.ts:73`), but OpenAI reasoning models ignore it (`openai.ts:24-35`). The flaky rule catches the resulting noise; it does not remove it. A `with` versus `with` calibration run can measure the noise floor.
- Three repeats is a small sample. Thresholds are heuristics and are not tuned on data.
- Full is 3× the cost of Quick.

### What this forbids

- Showing a Helps or Hurts verdict from a Quick run.
- Counting a flaky case as caught or regressed.
- Deriving a verdict from usage counts, accept rate or model self-reports.
- Reusing a verdict after `prompt_sha256`, carrier or carrier version changes, without the stale marker.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Observational accept rate | Free, uses live data | Confounded by PR and reviewer; measures people, not the skill |
| Pull frequency | Trivial | Constant: every effective skill loads on every run |
| LLM self-tag of finding source | Per-finding attribution | Unverifiable; model may confabulate |
| Shadow ablation on live runs | Real distribution | Doubles live cost; no ground truth for correctness; deferred |
| **Ablation eval on curated cases, Full mode only (chosen)** | Controlled, repeatable, has ground truth | Author-dependent cases; single carrier; cost |
| Key staleness on skill version | Simple | Metadata-only edits would invalidate evals |
| **Key staleness on `prompt_sha256` + carrier (chosen)** | Invalidates only when the model input changes | Needs hash stored per suite |
| Multiple carriers per suite | Broader validity | Cost multiplies; UI complexity; deferred |
