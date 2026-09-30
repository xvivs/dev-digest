# ADR 0022 — Derived PR brief: import-time cheap-model jobs, deterministic confidence cap and risk-ref grounding, untrusted intent prompt slot

**Status:** accepted
**Date:** 2026-09-30
**Relates to:** ADR 0002 (cost provenance), ADR 0013 (nonce prompt delimiters); [specs/04-pr-overview.md](../../specs/04-pr-overview.md), decisions D1, D1a, D2, D3, D6-D9

The code is not written yet. The spec holds the constants, caps, change sites and acceptance criteria.

## Context

The Overview tab shows only the raw PR description, and the review model never sees what the PR is for. The `pr_intent` table, the intent and risk contracts and the `review_intent` and `risk_brief` feature models exist with no writer.

Deriving an intent and risk areas needs LLM calls. That forces decisions on when they run and who pays for unreviewed PRs, what a review does with a missing or stale intent, which model runs them, which inputs are allowed (a PR body, a linked doc and a patch are attacker-writable), which outputs to trust (a model can overstate confidence and cite files not in the diff), and how a workspace or a test turns the spend off.

## Decision

1. **Import-time jobs plus an on-demand button (D1).** List sync, manual poll and detail refresh each make one fire-and-forget facade call after their GitHub call succeeds. The facade enqueues a `brief.derive` job for open PRs that lack an intent or risks row for the current `head_sha`. Scheduling is bounded, runs on its own single-concurrency, no-retry runner, and backs off after failures. It is skipped when the `review_intent` provider is not configured. No LLM or GitHub-detail call happens inside a request. The button bypasses the gates.

2. **Review pre-work reads and never derives (D1a).** A review uses an intent only if its row matches the current head. Otherwise it runs without one, the prompt stays byte-identical to today's, and a background derive is requested through the same automatic gate.

3. **A failed derivation aborts nothing (D2).** The review runs without intent. The Overview shows an error for that block only.

4. **Cheap, user-selectable models (D3).** `review_intent` and `risk_brief` default to `openrouter` / `deepseek/deepseek-v4-flash`. Users choose per feature in Settings → Models, which already lists both. The model is resolved on every job, never cached.

5. **Two switches for automatic work.** Env `AUTO_BRIEF` is the hard kill-switch. It defaults to off under `NODE_ENV=test`, and `scripts/e2e.sh` sets it off. The workspace setting `automatic_brief`, a toggle on the Settings → Models page, is the user preference. Its effective value is `value !== false`, so a missing row means on. Automatic work needs both. The setting applies without a restart. The UI cannot override the env. Neither switch affects `on_demand`.

6. **Same-repo docs only, read from git (D6).** Linked docs are read from the git object database at `head_sha`, not the working tree. A linked issue is fetched only for `closes/fixes/resolves #N` or a same-repo issue URL. Other hosts and repos are stored as unresolved links and never fetched, because the repo has no SSRF-safe fetch helper.

7. **Confidence is capped in code (D7).** The stored value is the lower of the model's value and a cap. The cap depends on the sources found: a resolved spec, issue or long description allows `high`, a short description `medium`, indirect signals alone `low`. An unresolved spec-like link lowers it to `medium`.

8. **Risks run in the same job, after intent (D8).** They are a separate call on `risk_brief`. They share the freshness key and the detail fetch, and the intent reaches them as untrusted input.

9. **Rule pre-pass and deterministic grounding (D9).** Rules produce `deps` and `db_migration` risks that are always kept. A model risk of a rule's kind merges into it, with the rule severity as a floor. Every model `file_ref` must match a changed file, and a line or range must intersect a changed hunk. Ungrounded refs are dropped and counted, and a risk left with no refs is dropped. If the model call fails, the rule risks are still stored, flagged `rule_only`.

10. **Intent enters the review as an untrusted slot (ADR 0013).** The prompt gets an optional `intent` section after the PR description. Its body is fenced by `wrapUntrusted` with the per-assembly nonce and size-capped, and its raw strings join the nonce inputs. The existing guard already covers derived intent. The intent and risk prompts use the same fencing, input caps and clamped output.

11. **Cost provenance (ADR 0002).** `pr_intent` and `pr_risks` store tokens and the `cost_usd` and `cost_source` pair through one upsert. Nothing is backfilled.

## Consequences

### What this enables

- The Overview shows intent and risks before anyone runs a review, and a review gets current intent at no added latency.
- Per the spec, one successful pass over a 50-PR first import costs about $0.14, and the failure worst case about $0.80.
- Tests and e2e cannot spend.

### What this costs

- Spend on PRs nobody reviews, bounded by the scheduling limits, and two switches to explain.
- The first review after a push usually lacks intent, because the background derive has not finished.
- Scheduling is skipped without an OpenRouter key. Queue state is in memory, so a restart drops it and the next sync reschedules.
- The two defaults live in three registries (two vendored `platform.ts` copies and a client copy).

### What this forbids

- Deriving in a request or in review pre-work.
- Fetching any URL other than a same-repo doc or issue.
- Storing model confidence or `file_refs` without the cap and grounding, or placing derived intent in a prompt outside `wrapUntrusted` and the nonce.
- Enabling automatic work from the UI when `AUTO_BRIEF` is off.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Derive in review pre-work | Pays only for reviewed PRs | First review waits; Overview empty until a review |
| Button only | No automatic cost | Overview empty by default |
| **Import jobs plus button (chosen)** | Overview filled before review | Pays for unreviewed PRs; needs caps and dedupe |
| Missing intent: await a derive | Always current | Adds latency to every review after a push |
| **Missing intent: review without it, derive in background (chosen)** | No added latency | First review after a push lacks intent |
| Env only, or toggle only | One knob | No user control, or tests depend on database state |
| **Env AND toggle (chosen)** | Tests safe; users control spend | Two knobs |
| Keep `gpt-4.1` | No change | About 14 times the input price |
| **`deepseek-v4-flash` via OpenRouter (chosen)** | Priced; provider-reported cost; matches `onboarding` and `conventions` | Needs an OpenRouter key |
| **`git cat-file` at `head_sha` (chosen)** | Offline; correct revision; symlinks cannot escape | Head may be missing from a shallow clone |
| **Risks in the intent job (chosen)** | One freshness key, one detail fetch | Risk cost paid for unreviewed PRs |
