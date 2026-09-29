# API Contract experiment: results

Filled from measured runs, including a failure to reproduce (AC-53). Do not
edit `protocol.md` to fit these numbers.

## Setup

| Field | Value |
|---|---|
| Date | 2026-09-29 (runs 23:07 to 23:20 UTC) |
| Model / provider | `deepseek/deepseek-v4-flash` via `openrouter` |
| Temperature | 0, implicit (`req.temperature ?? 0` in `reviewer-core/src/llm/openrouter.ts:87`; `review/run.ts:198` passes none). Not set explicitly, see Threats |
| Strategy | `single-pass` |
| Agent version id | `9d13d945` API Contract Reviewer, trace `config.version` = `1`, `current_version` null, no rows in `/agents/:id/versions` |
| PR head SHA (`demo/api-breaking-change`) | `0cb30e4d72fa389549d1a29c69addd324a7db707`, PR #5 on `xvivs/dev-digest`, base `l02-homework` |
| Database | `devdigest_l02hw` |

Skills linked in B, all enabled and vetted (`needs_vetting: false`, version 1):

| Order | Skill | id | source | tokens |
|---|---|---|---|---|
| 0 | `api-breaking-change` | `03317ae3` | imported | 505 |
| 1 | `response-schema` | `3602a35f` | manual | 597 |
| 2 | `semver-discipline` | `cf2961cb` | manual | 507 |
| 3 | `deprecation-policy` | `bd2dc529` | manual | 529 |

## Control check (prompt_assembly)

Checked on all six runs, with the per-request nonce replaced by a placeholder before comparing.

| Check | Result |
|---|---|
| User messages byte-identical | Pass. All six normalized user messages share one sha1 (`9c5d419d1a`) |
| System messages differ only in `<skills>` | Pass. B adds lines 64 to 297 (one intro line plus the `<skills>` block) and changes nothing else. The three A system messages match each other, and so do the three B ones |
| A: `skills` empty, `skills_tokens` = 0 | Pass with a note: the trace stores `skills`, `skills_used` and `skills_tokens` as `null`, not an empty list and 0 |
| B: four skills visible in RunTraceDrawer | Pass through the API: `skills_used` lists the four skills above in order, `skills_tokens` = 2195. The drawer UI was not opened |
| `tokens_in` delta vs `skills_tokens` | Mean B 16 065 minus mean A 13 744 = 2 320, which is 5.7% above 2 195. Within 10% |

## Scoring notes

Rules I applied to the frozen rubric. These readings do not change it.

- Location (element 1) uses the finding's `file:start_line-end_line`. A citation passes only when that range lies inside a frozen range. A range that overlaps but spills out (`routes.ts:37-40`, `findings.ts:11-12`, `helpers.ts:22-23` or `:25-61`) fails element 1 and can still make a semantic hit.
- A strict cell of `P` covers any finding on the breakage that fails the strict hit, including one that misses only the location.
- Path (element 3) passes for a major bump, API versioning that keeps the old contract, `@deprecated`, `Deprecation`/`Sunset`, dual-write, or a time-boxed window that keeps accepting the old shape. "Keep it optional" alone, or "document it", fails.
- B2 extra need: the finding has to say 400 or 4xx. "Validation error" with no status counts as partial.
- B3 extra need: a client reading responses sees a parse failure or unknown value. Request-side 400 alone is partial.
- B4 extra need: the finding has to say the key is gone for the caller (`undefined`, missing) and that no deprecation notice or window exists. "No migration path" alone is partial.
- B1 extra need: no run in either arm said `routes.ts` is untouched, so every B1 cell is `P` even when the rest holds.

## Per-run scores

Cell values: strict / semantic, each `Y`, `P` (partial) or `N`.

| Cond | Run | Run id | B1 | B2 | B3 | B4 | Strict /4 | Semantic /4 | FP | Extra valid | Version bump noted | `skills_tokens` | `tokens_in` | Cost (USD) | `cost_source` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 1 | `ab45dff5` | P/P | P/P | P/P | P/P | 0 | 0 | 0 | 0 | N | 0 (null) | 13 740 | 0.001756 | provider |
| A | 2 | `0208d865` | P/P | P/Y | P/Y | P/Y | 0 | 3 | 0 | 0 | N | 0 (null) | 13 754 | 0.001599 | provider |
| A | 3 | `e6e4b98b` | P/P | P/P | Y/Y | Y/Y | 2 | 2 | 0 | 0 | N | 0 (null) | 13 739 | 0.001662 | provider |
| B | 1 | `b6086df8` | P/P | Y/Y | P/P | P/P | 1 | 1 | 0 | 1 | Y | 2 195 | 16 059 | 0.001930 | provider |
| B | 2 | `0c952300` | P/P | Y/Y | Y/Y | P/Y | 2 | 3 | 0 | 0 | P | 2 195 | 16 091 | 0.001838 | provider |
| B | 3 | `dfeac864` | P/P | Y/Y | Y/Y | P/Y | 2 | 3 | 0 | 0 | P | 2 195 | 16 044 | 0.001812 | provider |

Latency (`duration_ms`): A 88 079, 49 589, 51 836; B 59 321, 62 835, 53 208.
Findings per run: A 4, 4, 4; B 5, 4, 6. Every run returned `request_changes`, and grounding passed every finding.

Per-run notes:

- A1: B2 and B3 read as request-side "validation error" with no status. B4 cites `helpers.ts:22-23` and says only "no migration path".
- A2: B2, B3 and B4 carry all three elements but cite ranges that spill past the frozen lines.
- A3: B2 says "validation error" with no status. B3 and B4 are full strict hits.
- B1: B3 argues clients "will never see" `SUGGESTION`, which misses the parse-failure claim. B4 says consumers "may depend" on the field and never states what they see. The one extra valid finding flags the missing `package.json` bump and changelog entry.
- B2 and B3: B4 cites `helpers.ts:22-23` and `:25-61`, both outside the frozen lines. B3 run also repeats B1 and B3 for the client vendored copies. I counted those as duplicates, not as FP. Both runs say "no version bump" and neither mentions the changelog, hence `P` for the cross-cutting element.

## Summary by condition

| Cond | B1 hits /3 | B2 hits /3 | B3 hits /3 | B4 hits /3 | Mean strict /4 | Mean semantic /4 | FP total | Avg `tokens_in` | Avg cost (USD) |
|---|---|---|---|---|---|---|---|---|---|
| A | 0 (sem 0) | 0 (sem 1) | 1 (sem 2) | 1 (sem 2) | 0.67 | 1.67 | 0 | 13 744 | 0.001672 |
| B | 0 (sem 0) | 3 (sem 3) | 2 (sem 2) | 0 (sem 2) | 1.67 | 2.33 | 0 | 16 065 | 0.001860 |

Total measured cost of the six scored runs: $0.0106. Two cancelled runs (below) report no cost.

## Reading

Verdict: reproduced by the letter of the rubric, with low confidence.

B beats A by 1.0 in mean strict hits, and two per-breakage counts rise (B2 0 to 3, B3 1 to 2). B4 falls from 1 to 0 and B1 stays at 0 in both arms. That meets the delta rule. AC-52 fails: A3 scored strict hits on B3 and B4, both skill targets.

Most of the delta sits in B2, and one wording choice decides it. All six runs found the `strategy` change. The three B runs wrote "400". Two A runs wrote "validation error". If you read "validation error" as 400, A scores B2 in 2 of 3 runs, mean strict A rises to 1.33, and the delta drops to 0.33, which the protocol calls not reproduced.

The generic prompt found every breakage in every run in both arms. The skills changed how B wrote findings, not what it found: B runs named `@deprecated`, `Deprecation`/`Sunset`, dual-write and a major bump more often, and one of them flagged the missing version bump and changelog. Neither arm said the B1 rename sits outside `routes.ts`, so B1 is 0/3 strict in both.

## Threats to validity

- The PR description lists all four changes in plain words ("align finding line field names", "simplify severity levels", "make the review strategy an explicit parameter", "drop an unused field"). The protocol asked for a description that does not point at the breakages. Both arms read it, and several findings quote it.
- PR base is `l02-homework`, not `main` as the protocol says.
- Temperature 0 comes from a default, not an explicit setting. Review calls pass no `disableReasoning` or provider routing, so OpenRouter may route runs to different upstreams. `tokens_in` varies by up to 15 tokens across identical A prompts.
- Two runs hung and I cancelled them: `d700a086` (A, started by the previous session at 22:50, no event after "Reviewing all files" for 17 minutes) and `42e9897f` (B, same stall past 5 minutes). Their sockets to OpenRouter stayed open after cancel, so they may still bill. I excluded both and replaced each with a fresh run in the same condition. The OpenAI SDK timeout (90 s) appears not to cover a stalled response body.
- A2 and A3 ran in parallel, as did B2 with the cancelled B3.
- One scorer, the same agent that ran the experiment. The partial cut for B2 ("validation error" without 400) and the strict location rule each move the verdict.
- The `skills_tokens` null in A was taken as 0.
