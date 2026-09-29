# API Contract experiment: results

Empty until runs happen. Fill as measured, including a failure to reproduce (AC-53). Do not
edit `protocol.md` to fit these numbers.

## Setup

| Field | Value |
|---|---|
| Date | |
| Model / provider | |
| Temperature | |
| Strategy | |
| Agent version id | |
| PR head SHA (`demo/api-breaking-change`) | |
| Database | |

## Control check (prompt_assembly)

| Check | Result |
|---|---|
| User messages byte-identical | |
| System messages differ only in `<skills>` | |
| A: `skills` empty, `skills_tokens` = 0 | |
| B: four skills visible in RunTraceDrawer | |
| `tokens_in` delta vs `skills_tokens` | |

## Per-run scores

Cell values: strict / semantic, each `Y`, `P` (partial) or `N`.

| Cond | Run | Run id | B1 | B2 | B3 | B4 | Strict /4 | Semantic /4 | FP | Extra valid | Version bump noted | `skills_tokens` | `tokens_in` | Cost (USD) | `cost_source` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 1 | | | | | | | | | | | 0 | | | |
| A | 2 | | | | | | | | | | | 0 | | | |
| A | 3 | | | | | | | | | | | 0 | | | |
| B | 1 | | | | | | | | | | | | | | |
| B | 2 | | | | | | | | | | | | | | |
| B | 3 | | | | | | | | | | | | | | |

## Summary by condition

| Cond | B1 hits /3 | B2 hits /3 | B3 hits /3 | B4 hits /3 | Mean strict /4 | Mean semantic /4 | FP total | Avg `tokens_in` | Avg cost (USD) |
|---|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | | |
| B | | | | | | | | | |

## Reading

Verdict against the protocol's delta rule: reproduced / not reproduced / partly. Then a short
account of what differed and what did not.
