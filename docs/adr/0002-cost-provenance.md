# ADR 0002 — a cost figure is never stored without its origin

**Status:** accepted
**Date:** 2026-09-19

## Context

DevDigest records what each agent run costs. There are two ways to obtain that
number, and they are not interchangeable.

**A charge.** OpenRouter returns `usage.cost` in the completion response
(`reviewer-core/src/llm/openrouter.ts:97-107`). That figure is what the provider
billed. It accounts for caching, discounts and whatever else the provider
applied, because the provider computed it.

**An estimate.** OpenAI (`server/src/adapters/llm/openai.ts:84,122`) and
Anthropic (`anthropic.ts:85,135`) return no cost at all, and their `/v1/models`
endpoints expose no prices. For those providers we multiply token counts by a
local rate table. Three properties of that path matter:

- the table describes itself as approximate and unverified (`pricing.ts:27-29`);
- it is read through a six-hour cache whose cold and warm states can yield
  different numbers for the same model (`price-book.ts:34-39`);
- the calculation is `in × rate + out × rate` (`pricing.ts:37-41`) — it does not
  know about cached input tokens, which are billed at a different rate. It
  therefore overstates, and overstates most when prompt caching works best. A
  review agent with a stable system prompt is exactly that case.

Both paths currently land in the same field: `costUsd: number | null`
(`server/src/vendor/shared/adapters.ts:48`). That type destroys the distinction,
and its `null` is ambiguous too — it means both "no price for this model" and
"this provider never reports cost".

The decision is forced now because L01 puts cost in front of users, and because
contracts for later lessons already reserve aggregate cost fields:
`AgentStats.total_cost_usd` and `avg_cost_usd`
(`contracts/observability.ts:108-109`), `AgentPerf.summary.total_cost_usd`,
`cost_by_agent`, `cost_by_model` (`contracts/productionize.ts:177,183-184`).
Whoever wires those will reach for `SUM(cost_usd)`. Against an untagged column
that silently adds provider invoices to our own arithmetic and produces a total
that cannot be reconciled against any bill — with nothing in the schema hinting
that it is mixed.

## Decision

A cost is stored as a pair, never as a bare number:

```
cost_usd     double precision  -- the figure
cost_source  text              -- 'provider' | 'estimated'
```

- `provider` — the provider reported this charge in its API response.
- `estimated` — we computed it locally from a price table.
- Both columns are null together, or neither is. A figure without an origin is
  not a valid row; an origin without a figure says nothing.

This pair travels intact from the adapter through `ReviewOutcome`, into
`agent_runs`, and out through the DTOs to the UI, which renders `$0.0013` for a
charge and `~$0.0013` for an estimate.

Where a run makes several model calls, the weaker claim wins: a sum is
`provider` only if every call reported a provider charge, and any missing chunk
nulls the whole figure.

`cost_source` is an open enumeration, not a boolean. `is_estimated` would have
been cheaper and would have locked the domain at two states forever.

## Consequences

### What this enables

- The UI can be honest without a second lookup — the origin travels with the
  figure.
- Aggregation can be correct: sum within one `cost_source`, or label the total
  as mixed. The information needed to choose is in the row.
- When a rate in the table turns out to be wrong, the rows to recompute are
  `WHERE cost_source = 'estimated'`. Provider charges stay untouched, because
  they were never ours to correct.
- A third origin can be added later — a figure reconciled against an actual
  invoice, say — without a schema change.

### What this costs

- One extra column, one extra DTO field per cost-bearing contract, carried
  through both vendored copies of `@devdigest/shared` (see ADR 0001 — they have
  no sync script).
- The invariant "both null or neither" is not enforced by the database. This
  schema uses no CHECK constraints anywhere, and `pgEnum` appears nowhere either
  — enum-shaped columns are `text(col, { enum: [...] })`, which narrows in
  TypeScript and emits plain `text` in SQL. The invariant is held by the single
  write path, `completeAgentRun`.
- Two visually different renderings of the same concept, which is one more state
  for every surface to handle.

### What this forbids

- Writing `cost_usd` without `cost_source`, anywhere, including seeds, fixtures
  and backfills.
- `SUM(cost_usd)` across mixed sources without labelling the result as mixed.
- Backfilling historical runs from the current price table. Today's rate applied
  to a month-old run produces a figure nobody was charged, wearing a label that
  says we estimated it — which is true and still misleading. Old runs show a
  dash.
- Presenting an estimate without its marker on any surface, on the grounds that
  the marker is visual noise.

## Alternatives considered

| Option | Why not |
|---|---|
| **Strict — store only provider charges** | Maximally honest per figure, but OpenAI and Anthropic never report cost, so those runs would show a dash permanently and the PR list's COST column would be mostly empty. It answers the accuracy question by abandoning the feature for two of three providers |
| **Silent blend — one number, no marker** | The least work, and the mockups match it exactly. It also quietly presents an estimate as a charge — and with prompt caching that estimate can be off by a multiple, with nothing in the UI or the schema to warn anyone |
| **Boolean `is_estimated`** | Same information today, no room tomorrow. A reconciled-against-invoice figure is neither true nor false on that axis |
| **Recompute at render instead of storing** | No migration, but historical figures shift retroactively whenever the price table changes, and the PR list would need a join plus arithmetic per row |

## Revisit when

- OpenAI or Anthropic begin returning an actual per-request charge in the
  response — then those runs move from `estimated` to `provider` and the split
  narrows to whoever is left, **or**
- a third origin is needed (reconciliation against a provider invoice), **or**
- the estimate path starts accounting for cached-token pricing, which changes
  how wrong `estimated` can be but not that it is an estimate.
