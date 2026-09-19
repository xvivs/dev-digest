# Spec: Cost Badge

**Spec ID:** SPEC-01 · **Status:** draft · **Lesson:** L01 (first half)

**Affected modules:** `server` (reviews · pulls · adapters/llm · db) ·
`client` (pulls · RunHistory · RunTraceDrawer) ·
`reviewer-core` (review/run · llm/openrouter) · vendored shared contracts ×2

## Problem & Motivation

A review run costs money, and nothing in the product says how much. You can see
that an agent ran, how long it took and what it found, but not what it charged.
Without that number there is no way to notice a misconfigured agent burning ten
cents per PR, and no way to compare a cheap model against an expensive one on
anything but output quality.

The data almost arrives already. `ReviewOutcome.costUsd`
(`reviewer-core/src/review/run.ts:110`) is computed on every run and then
dropped: `run-executor.ts:213` destructures `{ tokensIn, tokensOut, grounding }`
and lets the cost fall on the floor. `agent_runs` has no column for it, the DTOs
have no field for it, and no surface renders it.

Restoring that one value is straightforward. The part that needs deciding is
what the number *means*, because there are two different ways to obtain it:

- **A charge.** OpenRouter returns `usage.cost` in the API response
  (`reviewer-core/src/llm/openrouter.ts:97-107`). That is what was billed.
- **An estimate.** For OpenAI (`openai.ts:84,122`) and Anthropic
  (`anthropic.ts:85,135`) no such figure exists — their APIs never return one and
  their `/v1/models` carries no prices. We multiply tokens by a local rate table.

These are not the same quantity at different confidence levels. They are
different quantities. The estimate is built on a table that flags itself as
approximate (`pricing.ts:27-29`), read through a cache with a six-hour TTL that
returns different numbers cold and warm (`price-book.ts:34-39`), and computed by
a function that ignores cached-token pricing entirely (`pricing.ts:37-41`) — so
it overstates exactly where prompt caching works best, which for a review agent
with a fixed system prompt is most of the time.

Storing both in one `number | null` column erases the difference permanently.

## Goals / Non-goals

### Goals

1. Run cost is visible on three surfaces: the Agent runs timeline, the run trace
   drawer's Stats block, and the Pull Requests table.
2. A charge and an estimate are visually distinguishable at a glance, without
   hovering.
3. Cost is persisted with its origin, so later aggregation cannot silently mix
   the two.
4. The local price table knows the models we actually run.

### Non-goals

Each of these is excluded on purpose, not by oversight.

| Excluded | Why |
|---|---|
| Severity filter on findings | The other half of L01; unrelated to cost |
| FINDINGS column in the PR table | Present in the mockup, absent from the code, not about cost |
| Detailed usage accounting (`cache_read_input_tokens`, `cache_creation_input_tokens`, `prompt_tokens_details.cached_tokens`) | The next accuracy iteration. It makes the estimate *better*; this spec makes it *honest*. Those are separable |
| Sum of all runs on a PR, budgets, limits, spend alerts | Later lessons own aggregation; this one owns the single-run figure |
| Partial cost of a failed run | See Open questions — a deliberate trade-off, not an omission |
| Backfilling existing runs | A figure nobody was charged is worse than an empty cell. Old runs show a dash |

### Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Cost is stored as a pair: value + `cost_source` (`provider` \| `estimated`) | See ADR 0002 |
| D2 | Snapshot at run completion, not computed at render | The figure must not drift when the price table changes |
| D3 | The PR table shows the **last** run's cost, not a sum | A sum grows on every retry, including failed ones, and answers a different question |
| D4 | Adaptive precision, exact value in the tooltip | A fixed 2 decimals collapses every sub-cent run to `$0.00` |
| D5 | The timeline gains **tokens too**, not just cost | The mockup shows `9,119 tok · $0.0013`; `RunSummary` already carries the tokens, and cost without token context reads worse |
| D6 | Running and failed runs show a dash with a reason | Never a zero — zero means free, not unknown |

## User stories

- As an engineer reviewing a PR, I see what the last review cost, so I can tell
  an expensive agent from a cheap one before running it again.
- As an engineer reading a run trace, I see cost next to duration and tokens, so
  the three numbers that describe a run live together.
- As an engineer scanning the PR list, I see cost per PR, so an outlier is
  visible without opening anything.
- As an engineer looking at any cost figure, I can tell whether it is what the
  provider charged or what we calculated, without reading the source.

## Acceptance criteria (EARS)

### Timeline (Agent runs tab)

- **AC-1** — When a completed run is rendered in the timeline, the row shall show
  total tokens and cost in the right-hand column beneath the timestamp, in the
  form `9,119 tok · $0.0013`.
- **AC-2** — If `cost_source` is `estimated`, then the amount shall be prefixed
  with `~`.
- **AC-3** — While a run is `running` or `queued`, the cost shall render as `—`.

### Run trace drawer

- **AC-4** — When the Stats block is rendered, it shall show four cards in the
  order DURATION · TOKENS · COST · FINDINGS.
- **AC-5** — When a trace document predates this feature and carries no cost
  field, the drawer shall render `—` and parsing shall not fail.

### Pull Requests table

- **AC-6** — When the PR list is rendered, a COST column shall appear between
  STATUS and UPDATED, right-aligned.
- **AC-7** — When a PR has runs, the column shall show the cost of the most
  recent run, not the sum of all runs.
- **AC-8** — If a PR has no runs, then the column shall render `—`.

### Persistence

- **AC-9** — When a run completes, the server shall persist `cost_usd` together
  with `cost_source`.
- **AC-10** — `cost_usd` and `cost_source` shall either both be null or both be
  non-null; no row shall carry one without the other.
- **AC-11** — When a run makes several model calls (map-reduce), the persisted
  source shall be `provider` only if every call reported a provider charge.

## Edge cases

| Situation | Expected |
|---|---|
| Model absent from the price table | `—`, reason `no_price` |
| Run still in flight | `—`, reason `pending` |
| Run failed | `—`, reason `failed` |
| Map-reduce, chunks from mixed sources | Sum, labelled `estimated` |
| Any chunk reports no cost | Whole run is null — a partial sum is not a cost |
| Free model, genuine zero | `$0.0000`, never `—` |
| Runs recorded before this feature | `—`; no migration invents a figure |
| Cost ≥ $1 | 2 decimals (`$1.24`); the tooltip keeps full precision |

### Chunk folding rule

The weaker claim wins, because a badge must not promise precision it does not
have.

| Chunk A | Chunk B | Sum | `cost_source` |
|---|---|---|---|
| provider | provider | Σ | `provider` |
| provider | estimated | Σ | `estimated` |
| estimated | estimated | Σ | `estimated` |
| any | `null` | `null` | `null` |

A null cost also nulls the source: an origin without a figure says nothing.

## Non-functional

- The PR list costs **one** additional SQL round-trip per page, independent of
  how many PRs it holds. No per-row query.
- `agent_runs` gains an index on `(pr_id, ran_at DESC)` — the table currently has
  none, and "latest run per PR" is the access pattern this feature introduces.
- Rendering adds zero network calls: every surface reads a hook it already uses.
- `cost_missing_reason` is derived at read time from run status, never stored, so
  the status-to-reason mapping exists in one place rather than three.

## Inputs (provenance)

| Input | Provenance |
|---|---|
| `usage.cost` from OpenRouter | `[reused:` `reviewer-core/src/llm/openrouter.ts:97-107` `]` — already read, currently collapsed into `??` |
| Token counts | `[reused:` `agent_runs.tokens_in/out` `]` |
| Local rate table | `[reused:` `server/src/adapters/llm/pricing.ts` `]` — extended with current models |
| Live OpenRouter prices | `[reused:` `server/src/platform/price-book.ts` `]` |
| `cost_source` | `[new:` enum column on `agent_runs` `]` |
| `cost_missing_reason` | `[deterministic:` derived from `status` at read time `]` |
| Latest-run lookup | `[reused:` pattern of `latestReviewByPr`, `pulls/routes.ts:114-130` `]` |

## Untrusted inputs

`usage.cost` is a number supplied by a third-party API. It is stored and
rendered, never evaluated, and never used to gate control flow. A hostile or
malformed value can at worst produce a wrong figure in a badge — it reaches no
query, no filesystem path and no prompt. The pricing table is repo-controlled.

## Open questions

1. **Partial cost of a failed run.** A run that dies after three of five chunks
   has really spent money, and this spec shows a dash. The engine throws on
   failure and the accumulated total dies with the exception; capturing it would
   mean threading a progress sink through `reviewer-core`, which today reports
   outward only through `onEvent`. Deferred, and named here so the gap is not
   mistaken for full coverage.
2. **Estimate accuracy without cached-token pricing.** The current calculation
   overstates, and overstates most when prompt caching works best — which for a
   review agent with a stable system prompt is the normal case. The tilde makes
   the figure honest about being an estimate; it does not make the estimate
   correct. See Non-goals.
