# Spec: Blast Radius — close the L04 gaps (links, honest reasons, rank order, Resync, working MCP tool)

**Status:** draft, approved by the human; review loop complete (2 full rounds + 1 architecture-only delta round on graph a11y: plan-critic ACCEPT, architecture-reviewer APPROVE) · **Branch:** `feat/l04-lab` · **Approach:** fixed by the human in the delegation brief: finish the existing Blast Radius feature against `specs/08-blast-radius.requirements.md` (source of truth, not edited here). Three user decisions are inputs, not options: (1) MCP `get_blast_radius` is a **thin projection of the route**; (2) `BlastReason` is **extended additively** with the facade's `index_failed`, `repo_too_large`, `no_data`; (3) downstream is **sorted on the server** in `toBlastRadius`.

Every `path:line` below was read on 2026-10-01 against `feat/l04-lab` @ `85d5249`. "R-P1.5" = requirements, P1 item 5.

## Problem & Motivation

Most of the feature already ships: `GET /pulls/:id/blast`, the `pr_blast_cache`, the Overview card with tree, graph and Prior PRs, 44 green server tests. The homework acceptance list still has these gaps:

| Requirement | Gap today (evidence) |
|---|---|
| R-P1.5 click `file:line` → GitHub line | caller path is plain text: `BlastTree.tsx:31-35`; the card gets only `prId` (`BlastRadiusCard.tsx:24`, `OverviewTab.tsx:13,29`) |
| R-P1.6 incomplete index = separate badge with reason | a `div role=status` notice, not a badge: `BlastRadiusCard.tsx:89-97` |
| R-P1.7, R-P2.8 working MCP tool | stub: `mcp/src/tools/get-blast-radius.ts:33-54`, `mcp/src/project.ts:284-298`, registered without deps `mcp/src/server.ts:26` |
| R-P2.7 `degraded` + `reason` reach the UI | every non-partial degradation collapses to `no_index` (`server/src/modules/blast/domain.ts:79`); the facade's own reason is dropped in wiring (`blast/wiring.ts:46-55` does not copy `r.reason`); `indexState.degradedReason` is never read (`wiring.ts:33-37`) |
| R-P3.5 symbols sorted by rank | `toBlastRadius` keeps declaration order (`domain.ts:39-41`); `rank` is not even in `BlastInput.callers` (`domain.ts:10`) |
| R-P3.6 Resync button next to the badge | none; `useResyncRepoIntel` exists (`client/src/lib/hooks/repo-intel.ts:42-51`) but invalidates only `["repo-intel-state", repoId]` |
| R-P2.1 logs show an index read, not a re-parse | only `debug` lines named `blast` with no repo/index fields (`blast/service.ts:49,65,85-96`); `BlastLogger` has only `debug` (`blast/ports.ts:51-53`) |
| R-P2.5 declaring file is not its own caller | holds today only as a side effect of the resolver (see D7); no test pins it |
| R-P1.6 "no callers" text | `toBlastRadius` emits one group per changed symbol even with zero callers (`domain.ts:42`), so `downstream` is empty only with zero symbols; the card tests `blast.downstream.length === 0` (`BlastRadiusCard.tsx:71`), so a PR with symbols but no callers shows "0 callers" rows and no state text |
| R-P3.7 labels from `blast.json` | `callerCount: "{count} callers"` has no plural ("1 callers"); `noDownstream` uses "symbol(s)" |

## Goals / Non-goals

### Goals
- G1. Every caller `file:line` in the tree, and every caller node in the graph, opens that line on GitHub at the revision the line numbers were read from.
- G2. Degradation reason is specific end to end (facade → domain → cache → route → UI badge → MCP).
- G3. `downstream` (and `changed_symbols`) come back in rank order from the server.
- G4. A Resync button next to the badge triggers `POST /repos/:id/resync`; the card refreshes after the index run finishes.
- G5. `get_blast_radius` returns the route's map through the typed allowlisted client, with useful errors.
- G6. One `info` log line per blast read proves which source served it (index vs ripgrep fallback).
- G7. A test pins "the declaring file is not among its own callers".
- G8. Count-bearing labels in `blast.json` use ICU plurals.

### Non-goals
- Card redesign; layout beyond swapping the notice for a badge row with a button.
- Any change to Prior PRs (`PriorPrs`, `history` module).
- New LLM calls; the optional text summary (R-P2.4) is not built.
- Changing the facade algorithm or the indexer (`repo-intel/service.ts`, `repo-intel/pipeline/**`, `repo-intel/repository.ts`). D7 adds a domain guard instead.
- Hand-written or hand-edited migrations.
- The PR, the demo video and the "which subagent did what" text (R-P1.8, R-P2.9): human / orchestrator.
- R-P2.6 needs no change: no literal `20` or `2` used as a cap or depth exists in `BlastRadiusCard/**`, `OverviewTab/helpers.ts`, `OverviewTab/constants.ts` (the only cap is the graph draw cap `GRAPH_MAX_CALLERS = 8`, `OverviewTab/constants.ts:23`). AC-16 re-checks it by grep.

### Decisions

- **D1 — Link sha is `source_sha`, not `head_sha`.** Callers are computed against the indexed revision, the clone's default branch (spec 04 D14, `specs/04-pr-overview.md:248`). `source_sha` = `last_indexed_sha` for `full`/`partial`, else the clone HEAD (`blast/domain.ts:83-85`). `last_indexed_sha` is `git.currentHead` at index time (`repo-intel/pipeline/full.ts:276`, `incremental.ts:267`); the clone sits on `origin/<default>` after `reset --hard` (`adapters/git/simple-git.ts:123-134,137`) and is never checked out to a PR head. The ripgrep fallback reads that same working tree, so its lines are valid at the clone HEAD, which is what `source_sha` holds on that path. `head_sha` is the PR head: if the PR edits a caller file, the line numbers shift and the link lands on the wrong line. When `source_sha` is `null` or `''`, or `repoFullName` is `null`, the path renders as plain text (today's markup).
- **D2 — `repoFullName` and `repoId` are drilled as props** from `PrDetailContent` (`PrDetailContent.tsx:26-33`, already has both; `repoFullName` comes from `useActiveRepo().full_name`, `PrDetailView.tsx:24`) through `OverviewTab` to `BlastRadiusCard`, then `repoFullName` + `sourceSha` to `BlastTree`. Same pattern as `FindingCard.tsx:55` and `EvidenceBlock.tsx:52`. Alternative rejected: calling `useActiveRepo()` inside the card (a second source of truth for the same repo, and the card would stop being renderable from `prId` alone in tests).
- **D3 — Link rendering uses `MonoLink href`** (`client/src/vendor/ui/primitives/MonoLink.tsx:25-38`: `<a target="_blank" rel="noopener noreferrer">`, `stopPropagation`). The `title` and the truncating `callerPathText` span stay. URL built by `githubBlobUrl(repoFullName, sha, file, line)` (`client/src/lib/github-urls.ts`, encodes every path segment). The null-guard lives in a pure `blastCallerHref(repoFullName, sourceSha, file, line): string | null` in `OverviewTab/helpers.ts`.
- **D4 — Reason mapping (replaces the table at `specs/04-pr-overview.md:559-560`).** `BlastReason` becomes `index_partial | no_index | flag_off | no_changed_files | index_failed | repo_too_large | no_data` (append order, both vendored copies identical). `blastVerdict` order:

  | # | Condition | status / reason |
  |---|---|---|
  | 1 | `repoIntelEnabled === false` | `degraded / flag_off` |
  | 2 | `index.status === 'partial'` | `degraded / index_partial` |
  | 3 | `index.status === 'full'` and `!input.degraded` | `ok / null` |
  | 4 | `index.status === 'full'` and `input.degraded` (ripgrep fallback) | `degraded / (input.reason ?? 'no_data')` |
  | 5 | `index.status === 'failed'` | `degraded / (index.degradedReason ?? 'index_failed')` |
  | 6 | anything else (`degraded`, synthesised no-row state) | `degraded / (index.degradedReason ?? 'no_data')` |

  Facts behind it: the facade's `DegradedReason` is exactly `flag_off | index_failed | index_partial | repo_too_large | no_data` (`repo-intel/types.ts:29-34`); a persisted `degraded`/`failed` row reports `stats.degradedReason ?? 'index_failed'` (`repo-intel/repository.ts:261-266`); a missing row is synthesised with `degradedReason: 'no_data'` (`repo-intel/service.ts:327-340`); `no_clone` persists `degradedReason: 'no_data'` (`pipeline/full.ts:87-91`). No producer emits `repo_too_large` today (grep over `server/src`); it is accepted because the facade type allows it. **`no_index` is no longer produced** but stays in the enum: old cache rows and the DB CHECK carry it, and removing an enum value is a breaking contract change. The client keeps its i18n key.
  The domain declares a module-local `FacadeDegradedReason` literal union (same five values) on `IndexSnapshot.degradedReason?` and `BlastInput.reason?`; nothing is imported from `repo-intel` (module rule, `onion-architecture` rule 6). Wiring passes the facade values through; if repo-intel ever adds a value, `wiring.ts` stops typechecking, which is the intended tripwire.
- **D5 — Cache invalidation via `mapping_version`.** Old rows stay *valid* after D4 (old values remain in the enum and the CHECK; `PrBlastResponse` still parses them) but they are *stale*: they carry `no_index` and the unsorted order, and `sameBlastKey` (`domain.ts:87-95`) would keep serving them until the index sha moves, which on a quiet default branch may be never. Decision: new column `pr_blast_cache.mapping_version integer NOT NULL DEFAULT 0`, a domain constant `BLAST_MAPPING_VERSION = 1` in a new `server/src/modules/blast/constants.ts`, and `mappingVersion` added to `BlastKey` and `sameBlastKey`. Existing rows read `0` → miss → recompute → upsert writes `1`. Future mapping changes bump the constant.

  | Option | Pros | Cons |
  |---|---|---|
  | **A. `mapping_version` column (chosen)** | generated migration; reusable for every future mapping change; testable in `blast-repository.it.test.ts` | one more column + migration |
  | B. Treat `reason === 'no_index'` as a miss | no schema change | does not fix the old sort order; a one-off hack |
  | C. Accept staleness until the next index | zero work | AC-6 / AC-7 fail on any already-cached PR — including the demo PR |
  | D. `DELETE FROM pr_blast_cache` in a custom migration | one statement | hand-written migration (forbidden, AGENTS.md "Do not touch") |
- **D6 — Server-side order.** In `toBlastRadius`: callers inside a group sorted by `rank` desc, then `file` asc, then `line` asc; groups sorted by max caller `rank` desc (a group with no callers sorts after every group with callers), then caller count desc, then `symbol` asc. String compares use `<`/`>` (code-unit order), not `localeCompare`, so the order does not depend on the server's locale. `changed_symbols` follow the same order: by their name's position in the sorted `downstream`, ties by `file` asc. Reason: the MCP output returns both lists; one consistent order lets a reader match them without re-sorting. `BlastInput.callers[]` gains `rank: number` (the facade always sets it, `0` on the ripgrep path, `repo-intel/types.ts:77`); on the fallback path all ranks are 0 so the tie-breakers decide. The contract does not change.
- **D7 — Self-caller guard in the domain, not SQL.** `getResolvedCallers` (`repo-intel/repository.ts:541-569`) filters `decl_file IN changedFiles` and has no `from_path <> decl_file` predicate. It holds in practice because `decl_file` is resolved only through import edges, so a same-file reference keeps `decl_file NULL` (investigator, `repo-intel/pipeline/**`; a self-edge in `file_edges` was not ruled out). Rather than edit the facade (Non-goal), `toBlastRadius` drops any caller whose `file` equals the `file` of a changed symbol with the same name as its `viaSymbol`. Pure, covers both the persistent and the ripgrep paths (the latter already skips `r.fromPath === sym.file`, `repo-intel/service.ts:409`), and is unit-tested (AC-9). Cost: if two changed files declare the same bare name, a caller in one of them that really calls the other's symbol is dropped. That is the existing bare-name merge limitation (`domain.ts:37`) and is listed under Edge cases.
- **D8 — Log line.** `BlastLogger` gains `info`. Wiring maps it to `container.logger.info` (precedent `brief/wiring.ts:95`; `ContainerLogger` has `debug|info|warn`, `platform/container.ts:72`). The computed path and the cache-hit path each emit one `info` with message `blast index read` and fields `{ prId, repoId, indexStatus, sourceSha7, changedFiles: <count>, symbols, callers, cached, source: 'index' | 'ripgrep_fallback', reparse: boolean, status, reason, durationMs }`. `source` comes from a pure `blastSource(key: BlastKey): 'index' | 'ripgrep_fallback'` in `domain.ts`: `'index'` iff `repoIntelEnabled && indexStatus ∈ {full, partial}`, else `'ripgrep_fallback'` (the facade takes the persistent path exactly then, `repo-intel/service.ts:359-362,458`). Same function on the computed and cache-hit paths, so the log never disagrees with the key. `reparse = !cached && source === 'ripgrep_fallback'` (that path reads clone files and runs the code index, `repo-intel/service.ts:381-433`); a cache hit never re-reads anything, so `reparse: false`. Counts only, never file paths. These two lines replace the existing `debug` calls at `service.ts:65,85-96`; the `no_changed_files` debug at `:49` stays.
- **D9 — MCP output (thin projection).** Shape: `{ status: 'ok'|'degraded'|'unavailable', repo: string, pr_number: number, reason: <BlastReason> | null, summary: string | null, changed_symbols: [{name, file, kind}], downstream: [{symbol, callers: [{name, file, line}], endpoints_affected: string[], crons_affected: string[]}], head_sha: string, source_sha: string | null, truncated: boolean, next_step?: string }`. `summary`, `changed_symbols`, `downstream` come from `blast` (`null` → `null`/`[]`/`[]`); order and content 1:1 with the route. `repo` (the matched repo's `full_name` from `resolveRepo`, not the caller's spelling) and `pr_number` (the resolved PR's `number`) are echoed (human decision, OQ-3). Dropped: `cached`, `computed_at`, and `callers_count`, `top_callers` (the spec 07 shape). `source_sha` restored after live QA (user decision): caller line numbers are valid at it (D1). **Deliberate deviation** from `specs/07-devdigest-mcp.md:124,346` ("the output schema does not change"): the user chose 1:1 parity with the page block (R-P1.7 "returns the same map").
  - `reason` in the output schema is a local `z.enum([...])` of the seven values with a compile-time exhaustiveness assertion against `import type { BlastReason }` (the `server/src/db/schema/reviews.ts:32-35` pattern), because `schemas.ts` is the only runtime `@devdigest/shared` importer and its schemas are never handed to the SDK (`mcp/src/api/schemas.ts:1-9`, `mcp/test/hygiene.test.ts:76-81`).
  - Annotations: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`. `openWorldHint` flips to `true` because `resolvePr` calls `GET /repos/:id/pulls`, which syncs from GitHub and may schedule auto-briefs (spec 07 rule, `specs/07-devdigest-mcp.md:126`; `mcp/src/resolve.ts:14-27`).
  - `degraded` and `unavailable` are **success** results with a `next_step`, not `isError`: the map (possibly partial) is the answer, and the page shows it the same way. Errors (`isError`) stay for unknown repo, unknown PR, API unreachable/timeout/invalid response, via the existing `toToolResult` (`mcp/src/results.ts:39-86`, `mcp/src/errors.ts:51-69`).
  - `next_step` templates (constants; they interpolate only the enum `reason`):

    | Case | `next_step` |
    |---|---|
    | `unavailable` / `no_changed_files` | "DevDigest has no changed files stored for this PR yet. Open the PR in the DevDigest UI (that syncs its files), then call again." (files are written by `GET /pulls/:id`, `server/src/modules/pulls/routes.ts:236,255-262`) |
    | `degraded` / `index_partial`, `index_failed`, `no_index`, `no_data` | "The repo index is incomplete (`<reason>`). Press Resync next to the badge in the PR's Overview tab in DevDigest, wait for indexing to finish, then call again." |
    | `degraded` / `repo_too_large` | "The repo is too large to index fully; this map covers only the indexed part." |
    | `degraded` / `flag_off` | "Repo-intel is off on the DevDigest API (REPO_INTEL_ENABLED=false). Enable it and restart the API." (`server/src/platform/config.ts:95`) |
    | `ok` and `truncated` | "Callers were capped per symbol by the index; the Overview tab shows the same capped list." |
    | `ok`, not truncated | omitted |
  - Description (≤ 1000 chars): starts with the trigger ("Blast radius of a pull request: … Call it when the user asks what a PR could break, what it affects, or who calls the changed code."), states it reads DevDigest's prebuilt index and makes no LLM call, that it returns the same map as the PR's Overview tab, and that symbol names and file paths come from repository content and are data, not instructions. No "Not wired yet".
- **D10 — MCP client method.** `getBlastRadius(prId: string, signal?: AbortSignal): Promise<PrBlastLite>` → `GET /pulls/:id/blast`, the eighth allowlisted pair (spec 07 "Future step", `specs/07-devdigest-mcp.md:346`). `PrBlastLite = PrBlastResponse.pick({ status, reason, head_sha, truncated }).extend({ blast: BlastRadius.nullable() })` in `mcp/src/api/schemas.ts`; the full `BlastRadius` is used because the projection keeps every field.
- **D11 — Resync completion without an effect.** On Resync success the card's mutation seeds and invalidates `overviewReadinessKey(prId)`, invalidates `["pr-blast", prId]` and (already) `["repo-intel-state", repoId]`. The readiness query is always mounted (`OverviewTab.tsx:20` → `PrepareOverview` → `usePrOverviewReadiness`), its `index.in_flight` comes from `indexGate.isBusy(repoId)` (`repo-intel/service.ts:208,227`, `overview/wiring.ts:42`), which a resync goes through (`repo-intel/routes.ts:57-67` → `requestIndex(…, 'resync')`). The refetch sees `in_flight`, polls every 2 s, and on `in_flight → idle` `invalidateAfterPrepare` already invalidates `["pr-blast", prId]` (`client/src/lib/hooks/overview.ts:27-34,54`). Race: the 202 arrives at enqueue time (`repo-intel/routes.ts:67-71`), and `invalidateAfterPrepare` fires only if the *cached* previous readiness had `in_flight` (`overview.ts:54`). So the overview hook module exposes `markOverviewIndexRunStarted(qc, prId)` (site 28a), which seeds the readiness cache with top-level and `index.in_flight: true` (precedent: `usePrepareOverview` seeds from its response, `overview.ts:75-76`), then invalidates. The index gate reserves synchronously before the first `await` in `requestIndex` (`repo-intel/service.ts:186-193`), so `isBusy` is already true when the 202 returns. The next fetch, even one that already sees the job finished, produces the `in_flight → idle` transition and invalidates `pr-blast`. Implemented as an optional `prId` on `useResyncRepoIntel(repoId, options?: MutationHookOptions & { prId?: string })`; the only other consumer (`ConventionsView.tsx:67`) is unaffected.
  The button shows only when `status === 'degraded'` and `reason ∈ RESYNC_REASONS = ['index_partial', 'index_failed', 'no_index', 'no_data']` (`flag_off` and `repo_too_large` are not fixed by a resync). Label `blast:resync` / `blast:resyncing` while pending; `disabled` while pending. Errors go through the global `MutationCache.onError` (ADR 0011), no local toast. **Known overlap:** for `index_partial` at clone head, `PrepareOverview` also offers "Update index" (`PrepareOverview/helpers.ts:26`); R-P3.6 asks for the button next to the badge, so both stay.
- **D12 — Badge.** The notice `div` becomes a row (`role="status"`) holding `<Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">` (`Badge.tsx:5-49`; tokens from `primitives/tokens.ts:21`) with text `t("state.degraded")` + `" "` + `t(`reason.${reason}`)` and, when allowed, the Resync button. Badge style override `whiteSpace: "normal"` so a long reason wraps inside the ~460 px card (`client/INSIGHTS.md:125`). The row stays above the stats row; the stats/toggle row is untouched.
- **D13 — Client reason list.** The client may import only types from `@devdigest/shared` (`client/INSIGHTS.md:109,193`). `BLAST_REASONS` is a local `as const` tuple in `OverviewTab/constants.ts` with a `satisfies readonly BlastReason[]` + exhaustiveness assertion (same trick as `reviews.ts:32-35`); a test checks every entry has `reason.<value>` in `blast.json`.
- **D14 — ICU plurals.** next-intl `^3.26.0` (`client/package.json:19`) and the project already uses `{count, plural, one {…} other {…}}` (`client/messages/en/prReview.json:25`). Changed keys: `callerCount` → `"{count, plural, one {# caller} other {# callers}}"`; `noDownstream` → `"{count, plural, one {# changed symbol} other {# changed symbols}}, no downstream callers found."`; `stat.symbols|callers|endpoints|crons` → plural forms with `{count}` (`symbol/symbols`, `caller/callers`, `endpoint/endpoints`, `cron/crons`), and the card passes `{ count: st.value }`. `graph.more` (`"+{count} more"`) needs none.
- **D15 — Clickable graph nodes (human decision, OQ-2).** Each drawn caller node links to the same URL as the tree (`blastCallerHref`, D3). Today the graph is `<svg role="img" aria-label=…>` with caller `<text>` nodes (`BlastGraph.tsx:21,30-34`); `role="img"` makes every child presentational, so links inside it would be invisible and unreachable for assistive tech.

  | Option | Pros | Cons |
  |---|---|---|
  | **A. `role="group"` + SVG `<a>` per caller (chosen)** | the link is the node the user sees; native focus and Enter in SVG 2 browsers; middle-click / open-in-new-tab work; no duplicate markup | SVG `<a>` focus ring is the UA default (no inline `:focus` style); `rel` support on SVG `<a>` is less documented than on HTML `<a>` |
  | B. Keep `role="img"`, add a visually hidden HTML link list next to the SVG | SVG untouched | two sources of the same links; sighted mouse users still cannot click the node — fails the decision |
  | C. `onClick` + `window.open(url, "_blank", "noopener")` on `<text>` | explicit noopener | not a link (no middle-click, no keyboard focus without extra `tabIndex`/key handlers), re-implements a link |

  Markup: `<svg role="group" aria-label={t("graph.ariaLabel")}>`. Symbol labels stay readable (`<text>` inside a group is exposed as text); edges (`<line>`) get `aria-hidden="true"` (decorative). A linked caller is `<a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${name}:${line} (${file})`}><text …>{label}</text></a>`; the visible label stays `name:line` and the accessible name starts with it, then adds the path (WCAG 2.2 SC 2.5.3 Label in Name). A caller without a URL (no `source_sha` or no `repoFullName`) renders today's bare `<text>`. Tab order follows DOM order = layout order (D6 rank order). The opened URL is always `https://github.com/…` built by `githubBlobUrl`, so even if a browser ignored `rel` on SVG `<a>`, the opener is GitHub, not attacker content; step 10 checks `window.opener === null` in the opened tab anyway.
  `blastGraphLayout` callers gain `file: string; line: number` (`OverviewTab/helpers.ts:140-159` today keeps only `label`), so the component builds the URL with `blastCallerHref` and needs no second lookup into `downstream`.
- No new ADR needed for D1-D14 (no new pattern). ADR 0026 Decision 3 counts "seven" pairs; change site 35 rewords it count-free (owner `doc-writer`).

## Acceptance criteria (EARS)

- **AC-1 (R-P1.5).** When a blast response has a non-empty `source_sha` and the repo full name is known, the tree shall render each caller's `file:line` as an `<a>` with `href = githubBlobUrl(repoFullName, source_sha, file, line)`, `target="_blank"` and `rel="noopener noreferrer"`.
- **AC-2 (R-P1.5).** When `source_sha` is `null`/`''` or the repo full name is `null`, the tree shall render `file:line` as plain text.
- **AC-3 (R-P1.6, R-P2.7).** When `status === 'degraded'`, the card shall render a badge containing the degraded label and the reason's `blast.json` text; it shall render no badge when `status === 'ok'`.
- **AC-4 (R-P1.6).** When `blastStats(blast).callers === 0` (no caller in any group, including zero changed symbols), the card shall render `noDownstream` with `count = stats.symbols` instead of the tree or graph, in both views.
- **AC-5 (R-P2.7).** The server shall map index/facade state to `status`/`reason` exactly per the D4 table, and shall never return `reason: 'no_index'` from a fresh compute.
- **AC-6 (R-P2.7).** When a `pr_blast_cache` row has `mapping_version < BLAST_MAPPING_VERSION`, the service shall recompute and overwrite it instead of serving it.
- **AC-7 (R-P3.5, R-P2.3).** `toBlastRadius` shall order callers, `downstream` and `changed_symbols` per D6.
- **AC-8 (R-P2.2).** The route response shall still pass `PrBlastResponse` validation (Fastify response schema) for every new reason value.
- **AC-9 (R-P2.5).** `toBlastRadius` shall not list a caller whose `file` equals the declaring file of its `viaSymbol`.
- **AC-10 (R-P2.1).** When the blast service serves a computed or cached result, it shall emit exactly one `info` log `blast index read` with the D8 fields, `source`/`reparse` per `blastSource` (D8), `reparse: false` on every cache hit and whenever the persistent index served it, and no file path.
- **AC-11 (R-P3.6).** When the badge reason is in `RESYNC_REASONS`, the card shall show a Resync button; clicking it shall send `POST /repos/:repoId/resync` once and on success seed `overviewReadinessKey(prId)` with `in_flight: true` and invalidate it and `["pr-blast", prId]`. The button shall not render for `flag_off` or `repo_too_large`.
- **AC-12 (R-P1.7, R-P2.8).** When `get_blast_radius` is called for a known repo and PR, the server shall call `listRepos`, `listPulls`, `getBlastRadius` (in that order) and return the D9 shape whose `repo` equals the matched repo's `full_name`, `pr_number` equals the requested number, and `changed_symbols`, `downstream` (no cap, same order), `summary`, `status`, `reason`, `head_sha`, `truncated` equal the route response's.
- **AC-13 (R-P2.8).** When the repo or PR is unknown, or the API is unreachable, `get_blast_radius` shall return `isError: true` with the existing `repo_not_found` / `pr_not_found` / `api_unreachable` message and next step, and shall not call `getBlastRadius` for an unknown repo/PR.
- **AC-14 (R-P2.8).** When the route returns `degraded` or `unavailable`, `get_blast_radius` shall return a success result whose `next_step` is the D9 template for that reason.
- **AC-15 (R-P2.8).** `tools/list` shall show `get_blast_radius` with `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`, a description ≤ 1000 chars without "Not wired", and the D9 output schema.
- **AC-16 (R-P2.6).** `grep -nE '\b(20|2)\b' ` over `BlastRadiusCard/**/*.tsx` and `OverviewTab/helpers.ts` shall show no caller-cap or depth literal.
- **AC-17 (R-P3.7).** Every `BlastReason` value shall have a `reason.<value>` key in `client/messages/en/blast.json`; `callerCount` shall render "1 caller" for 1 and "3 callers" for 3.
- **AC-19 (R-P1.5, R-P3.2).** When the graph view draws a caller and `blastCallerHref` returns a URL, the graph shall wrap that caller's label in an SVG `<a>` with that `href`, `target="_blank"`, `rel="noopener noreferrer"` and `aria-label="<name>:<line> (<file>)"` (accessible name starts with the visible label); when it returns `null`, the label shall render without a link.
- **AC-20 (R-P3.2).** The graph `<svg>` shall have `role="group"` (not `img`) and its `aria-label`, and every edge `<line>` shall be `aria-hidden="true"`.
- **AC-18.** Both vendored `contracts/brief.ts` copies shall be byte-identical.

## Change sites

| # | File | Change | Layer | AC | Risk |
|---|---|---|---|---|---|
| 1 | `server/src/vendor/shared/contracts/brief.ts:93` | `BlastReason` += `index_failed`, `repo_too_large`, `no_data` (appended) | core (shared) | 5,8,18 | L |
| 2 | `client/src/vendor/shared/contracts/brief.ts:93` | identical edit | core (shared) | 18 | L: drift |
| 3 | `server/src/db/schema/reviews.ts:32,181-208` | `BLAST_REASONS` += same three (keeps the typecheck assertion green, regenerates the CHECK); `mappingVersion: integer('mapping_version').notNull().default(0)` on `prBlastCache` | infra (db) | 5,6 | M: CHECK swap on a live table |
| 4 | `server/src/db/migrations/0029_*.sql` + `meta/*` | generated by `pnpm db:generate` only | infra (db) | 5,6 | M |
| 5 | `server/src/modules/blast/constants.ts` (new) | `BLAST_MAPPING_VERSION = 1` | domain | 6 | L |
| 6 | `server/src/modules/blast/domain.ts` | `FacadeDegradedReason`; `IndexSnapshot.degradedReason?`; `BlastInput.reason?`, `callers[].rank`; `BlastKey.mappingVersion` + `sameBlastKey`; `blastVerdict` per D4; `toBlastRadius` D6 order + D7 guard | domain | 5,6,7,9 | M |
| 7 | `server/src/modules/blast/ports.ts:41-53` | `BlastCacheEntry` inherits `mappingVersion` via `BlastKey`; `BlastLogger.info` | app | 6,10 | L |
| 8 | `server/src/modules/blast/service.ts:50-94` | key gets `mappingVersion: BLAST_MAPPING_VERSION`; D8 `info` lines replace the `:65` and `:85-96` debug calls | app | 6,10 | L |
| 9 | `server/src/modules/blast/wiring.ts:33-58` | pass `indexState.degradedReason`, `r.reason`; callers keep `rank`; `log.info` | wiring | 5,7,10 | L |
| 10 | `server/src/modules/blast/repository.ts:12-53` | map `mappingVersion` ↔ `mapping_version` in `toEntry` and `upsert` | infra | 6 | L |
| 11 | `server/test/blast-domain.test.ts` | D4 table cases, D6 order, D7 guard, `sameBlastKey` with `mappingVersion` | test | 5,7,9 | L |
| 12 | `server/test/blast-service.test.ts:61,119,130-131` | logger fake gets `info` (records calls); expectations `no_index` → new reasons; mapping-version miss; log fields | test | 5,6,10 | L |
| 13 | `server/test/blast-repository.it.test.ts` | round-trip `mapping_version`; insert each new reason (CHECK accepts) | test | 6,8 | L |
| 14 | `server/test/blast-routes.it.test.ts:180-196` | `no_index` expectations → `no_data` (`:185`) and `index_failed` (`:195`); one case per new reason passes the response schema | test | 5,8 | L |
| 15 | `mcp/src/api/schemas.ts` | `PrBlastLite` (D10) | infra | 12 | L |
| 16 | `mcp/src/api/client.ts:1-28` + class | `getBlastRadius` (8th method); header comment "seven" → "eight" | infra | 12 | M: the permission boundary |
| 17 | `mcp/src/project.ts:282-298` | remove `blastRadiusStub`, `BLAST_RADIUS_NEXT_STEP`; add pure `projectBlastRadius(repo: string, prNumber: number, res: PrBlastLite): GetBlastRadiusOutput` + `BLAST_NEXT_STEP` templates | domain | 12,14 | L |
| 18 | `mcp/src/tools/get-blast-radius.ts` | D9 output schema, description, annotations; `registerGetBlastRadius(server, deps)`: `resolveRepo` → `resolvePr` → `deps.api.getBlastRadius(pr.id, extra.signal)` (precedent `run-agent-on-pr.ts:101`) → `ok(projectBlastRadius(r.full_name, pr.number, res))`; output schema adds `repo: z.string()`, `pr_number: z.number().int()` / `toToolResult(e)` | presentation | 12-15 | M: description is an injection surface |
| 19 | `mcp/src/server.ts:26` | `registerGetBlastRadius(server, deps)` | wiring | 12 | L |
| 20 | `mcp/test/fake-api.ts` | `blast: PrBlastLite` field + recording `getBlastRadius` | test | 12-14 | L |
| 21 | `mcp/test/api-client.test.ts:55-69` + `cases` | list of eight; a `GET /pulls/:id/blast` case | test | 12 | L |
| 22 | `mcp/test/contract.test.ts:148,323-331` | annotations (blast leaves `closedRead`, gets `openWorldHint: true`); replace the stub test with happy / degraded / unavailable / unknown-PR / unreachable cases | test | 12-15 | L |
| 23 | `mcp/test/project.test.ts` | `projectBlastRadius` cases (null blast, each next_step, order preserved) | test | 12,14 | L |
| 24 | `mcp/README.md:3,11,14` | tool row ("blast radius map of a PR", calls `GET /repos`, `GET /repos/:id/pulls`, `GET /pulls/:id/blast`); "eight endpoints"; intro mentions blast; the allow-rule note at `:72` gets the GitHub-sync caveat like `get_findings`; a line on `MAX_MCP_OUTPUT_TOKENS` for very large PRs | docs | 15 | L |
| 25 | `client/messages/en/blast.json` | D14 plurals; `reason.index_failed|repo_too_large|no_data`; `resync`, `resyncing` | client | 3,4,11,17 | L |
| 26 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/constants.ts` | `BLAST_REASONS` (D13), `RESYNC_REASONS` | client | 11,17 | L |
| 27 | `…/OverviewTab/helpers.ts` (+ `helpers.test.ts`) | `blastCallerHref`, `canResyncBlast(status, reason)`, `hasNoCallers(blast)` (= `blastStats(blast).callers === 0`) | client (domain) | 1,2,4,11 | L |
| 28 | `client/src/lib/hooks/repo-intel.ts:42-51` | optional `prId`; on success, when `prId` is set: call `markOverviewIndexRunStarted(qc, prId)` (site 28a) and invalidate `["pr-blast", prId]`. Importing a named operation from `./overview` has precedent (`hooks/evals.ts:9` imports from `./skills`); no cycle (`overview.ts:8-16`) | client (server state) | 11 | L |
| 28a | `client/src/lib/hooks/overview.ts` (+ `overview.test.tsx`) | export `markOverviewIndexRunStarted(qc, prId)`: `setQueryData(overviewReadinessKey(prId), (o) => o && { ...o, in_flight: true, index: { ...o.index, in_flight: true } })` (keeps the contract's "top-level = clone ∥ index ∥ brief" consistent, `contracts/overview.ts:78-79`), then invalidate that key. The readiness domain owns its cache writes | client (server state) | 11 | L |
| 29 | `client/src/lib/hooks/repo-intel.test.tsx` (new) | invalidation keys with and without `prId` | test | 11 | L |
| 30 | `…/PrDetailView/_components/PrDetailContent/PrDetailContent.tsx:115` | `<OverviewTab prId={prId} repoId={repoId} repoFullName={repoFullName} />` | client | 1,11 | L |
| 31 | `…/OverviewTab/OverviewTab.tsx:12-14,29` | props `repoId`, `repoFullName`; pass to `BlastRadiusCard` | client | 1,11 | L |
| 32 | `…/OverviewTab/_components/BlastRadiusCard/BlastRadiusCard.tsx` (+ `styles.ts`) | props `{ prId, repoId, repoFullName }`; both `downstream.length` checks (`:71` empty-state branch and `:78` `ScrollFadeRegion` wrap) key on `hasNoCallers(blast)` instead (AC-4), so the no-callers text is never inside the scroll region; D12 badge row + Resync; pass `repoFullName`, `data.source_sha` to `BlastTree` and `BlastGraph`; stat labels with `count` | client | 1,3,4,11,17,19 | M: header width |
| 33 | `…/BlastRadiusCard/_components/BlastTree/BlastTree.tsx:10,27-37` | props `repoFullName`, `sourceSha`; when `blastCallerHref` returns a URL: `<span style={s.callerPath} title={…}><MonoLink href={url}><span style={s.callerPathText}>{file}:{line}</span></MonoLink></span>` (MonoLink takes no `style`/`title` and sets `fontSize: 13`, `MonoLink.tsx:3-23`; the inner span keeps the existing truncation; check the ellipsis still applies in step 10); otherwise today's markup | client | 1,2 | L |
| 34 | `…/BlastRadiusCard/BlastRadiusCard.test.tsx`, `…/OverviewTab/OverviewTab.test.tsx` | new props; AC-1..4, AC-11, AC-17 cases | test | 1-4,11,17 | L |

| 36 | `…/OverviewTab/helpers.ts:140-159` (+ `helpers.test.ts`) | `BlastGraphLayout.callers[]` += `file`, `line` | client (domain) | 19 | L |
| 37 | `…/BlastRadiusCard/_components/BlastGraph/BlastGraph.tsx:15-38` (+ `styles.ts`) | props `repoFullName`, `sourceSha`; D15 markup (`role="group"`, `aria-hidden` edges, SVG `<a>` per linkable caller); `cursor: pointer` on linked labels in `styles.ts` | client | 19,20 | M: a11y regression if `role` stays `img` |
| 38 | `…/BlastRadiusCard/BlastRadiusCard.test.tsx` | graph view: link attributes, no link without `source_sha`, `role="group"`, edges hidden | test | 19,20 | L |
| 35 | `docs/adr/0026-devdigest-mcp-http-client.md:17` | **owner: `doc-writer`** (not the implementer). Decision 3 "seven explicit method+path pairs" → count-free "one explicit method+path pair per endpoint"; ADR is still `proposed` (`:3`), so edited in place | docs | 15 | L |

`server/src/modules/repo-intel/**` and `mcp/test/hygiene.test.ts` are not touched.

## Steps

Order: contract → DB → server ∥ MCP ∥ client. After step 2 there are three independent tracks. With two implementers: **A = steps 3-6 (server, then MCP)**, **B = steps 7-9 (client)**. MCP (5-6) depends only on step 1, so a third implementer can take it.

If `pnpm exec`/`pnpm run` fails with `ERR_PNPM_IGNORED_BUILDS`, use `sh node_modules/.bin/<bin> …` with the same arguments (`server/INSIGHTS.md:80`).

1. **Contract.** Sites 1, 2, and the `BLAST_REASONS` list in site 3. — verify: `cmp server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts && (cd server && pnpm typecheck) && (cd client && pnpm typecheck)` → exit 0. (The client typecheck still passes: `t(\`reason.${r}\`)` is untyped.)
2. **Schema + migration.** `mappingVersion` column in site 3, then `cd server && pnpm db:generate` (site 4). Do not edit the generated SQL. `pnpm db:migrate` does not run on boot: run it on the dev DB before step 10. — verify: `cd server && pnpm typecheck && grep -l "mapping_version" src/db/migrations/0029_*.sql && grep -c "no_data" src/db/migrations/0029_*.sql` → typecheck exit 0, file found, count ≥ 1 (the regenerated CHECK).
3. **Server domain** (sites 5, 6, 11). — verify: `cd server && pnpm typecheck && pnpm exec vitest run test/blast-domain.test.ts` → pass.
4. **Server app/infra/wiring** (sites 7-10, 12-14). — verify: `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run blast` → typecheck 0, no new arch violations, all `blast-*` tests pass (the `.it.test.ts` ones need Docker).
5. **MCP client boundary** (sites 15, 16, 20, 21). — verify: `cd mcp && pnpm typecheck && pnpm exec vitest run test/api-client.test.ts` → pass, the method list has eight names.
6. **MCP tool** (sites 17-19, 22-24). — verify: `cd mcp && pnpm typecheck && pnpm test` → all green, including `hygiene.test.ts` unchanged.
7. **Client copy, constants, helpers** (sites 25-27, 36). — verify: `cd client && pnpm typecheck && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/helpers.test.ts"` → pass.
8. **Client hooks** (sites 28, 28a, 29). — verify: `cd client && pnpm exec vitest run src/lib/hooks/repo-intel.test.tsx src/lib/hooks/overview.test.tsx` → pass.
9. **Client components** (sites 30-34, 37, 38). — verify: `cd client && pnpm typecheck && pnpm exec vitest run BlastRadius OverviewTab 2>&1 | tee /tmp/blast-vitest.log; ! grep -q MISSING_MESSAGE /tmp/blast-vitest.log` → pass, no `MISSING_MESSAGE` (`client/INSIGHTS.md:148`).
10. **Whole-feature check (orchestrator/human).** `cd server && pnpm db:migrate && pnpm test`; `cd client && pnpm test`; `cd mcp && pnpm test`; AC-16 grep; then the requirements' video script on a PR that changes `server/src/modules/reviews/helpers.ts` with `GET /repos/:id/index-state` = `full`: click a caller in the tree and in the graph, and Tab to a graph node + Enter (GitHub opens the line at `source_sha`; in the opened tab `window.opener === null`), check the API log for `blast index read … reparse:false`, call `get_blast_radius` from Claude Code and compare with the card. Browser checks need a real browser; say so if not run.

## Test plan

| AC | Test file (exact path) | Kind | Case |
|---|---|---|---|
| 5 | `server/test/blast-domain.test.ts` | unit | one `it.each` row per D4 row incl. `failed` without `degradedReason` → `index_failed`, synthesised `degraded` + `no_data`, full + `input.degraded` (only reachable when an index run changes state between `getKey` and `getBlastRadius`) → facade reason; `blastSource` table |
| 7 | `server/test/blast-domain.test.ts` | unit | groups by max rank; tie → caller count → symbol; zero-caller group last; callers rank/file/line; `changed_symbols` follow; all-rank-0 fallback deterministic |
| 9 | `server/test/blast-domain.test.ts` | unit | caller in the decl file of its `viaSymbol` is dropped; same file calling another changed file's symbol is kept |
| 6 | `server/test/blast-domain.test.ts`, `server/test/blast-service.test.ts` | unit | `sameBlastKey` false on `mappingVersion` diff; a stored entry with `mappingVersion: 0` recomputes and is overwritten with 1 |
| 10 | `server/test/blast-service.test.ts` | unit | fake logger records `info`: one call per GET, fields present, `reparse:false` when the key's `indexStatus ∈ {full, partial}` and the flag is on, `reparse:true` when `indexStatus ∉ {full, partial}` or `repoIntelEnabled` is false and not cached, `cached:true` on hit, no value contains `/` from a file path |
| 5, 8 | `server/test/blast-routes.it.test.ts` | `*.it.test.ts` | fallback → `no_data`; `failed` → `index_failed`; `degradedReason: 'repo_too_large'` → 200 and reason passes the response schema |
| 6, 8 | `server/test/blast-repository.it.test.ts` | `*.it.test.ts` | `mapping_version` round-trips; rows with each new reason insert (CHECK) |
| 12 | `mcp/test/contract.test.ts` | contract (in-memory SDK client) | happy fixture validates against `outputSchema`; `api.calls` = `listRepos`, `listPulls`, `getBlastRadius`; `downstream` equals the fixture's |
| 13 | `mcp/test/contract.test.ts` | contract | unknown repo / unknown PR → `isError`, no `getBlastRadius` call; fake throwing `ApiError` unreachable → `isError` with the start hint |
| 14 | `mcp/test/project.test.ts` | unit | each D9 `next_step` row; `blast: null` → `summary: null`, empty arrays |
| 15 | `mcp/test/contract.test.ts` | contract | annotations; description ≤ 1000 and lacks "Not wired" |
| 12 | `mcp/test/api-client.test.ts` | unit | eight methods; `GET /pulls/:id/blast` with encoded id, parse failure → `invalid_response` |
| 1, 2, 4 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/helpers.test.ts` | unit | `blastCallerHref` URL, `null` for missing sha / name / empty sha; `canResyncBlast` table; `hasNoCallers` (0 symbols, symbols without callers, one caller) |
| 19 | same `helpers.test.ts` | unit | `blastGraphLayout` callers carry `file`/`line` of the source caller, order unchanged, still ≤ `GRAPH_MAX_CALLERS` |
| 19, 20 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastRadiusCard/BlastRadiusCard.test.tsx` | RTL | switch to Graph: `getByRole("link", { name: /^<name>:1 \(src\/f0\.ts\)$/ })` has `href`, `target`, `rel`; without `source_sha` `queryAllByRole("link")` is empty; svg has `role="group"`; every `line` has `aria-hidden` |
| 17 | same `helpers.test.ts` | unit | every `BLAST_REASONS` entry has `blast.json` `reason.<v>` |
| 11 | `client/src/lib/hooks/repo-intel.test.tsx` | RTL hook | with `prId`: `markOverviewIndexRunStarted` effect visible (readiness `in_flight` and `index.in_flight` true), `pr-blast` + `repo-intel-state` invalidated; without `prId`: only `repo-intel-state` |
| 11 | `client/src/lib/hooks/overview.test.tsx` | RTL hook | pre-seed readiness `{ in_flight: false }`, mount `usePrOverviewReadiness(prId)`, call `markOverviewIndexRunStarted`, fake API answers idle → `GET /pulls/:id/blast` refetched; empty cache → seed is a no-op |
| 1, 3, 4, 11, 17 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastRadiusCard/BlastRadiusCard.test.tsx` | RTL (`renderWithProviders`, `setupFakeApi`) | link `href`/`target`/`rel`; plain text without `source_sha`; badge text for `index_failed`; no badge for `ok`; two symbols with zero callers → "2 changed symbols, no downstream callers found." and no tree rows (both views); Resync click → one `POST /repos/r1/resync`; no button for `flag_off`; "1 caller" |
| — | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.test.tsx` | RTL | renders with the new props |
| 16 | step 10 grep | manual | — |

## Edge cases

- Two changed files declare the same bare name: one `downstream` entry (existing limitation, `domain.ts:37`); D7 drops callers living in either decl file.
- All callers rank 0 (ripgrep fallback): order falls back to count, then name; callers by file, line.
- `source_sha === ''` (no clone): no links, "Based on index" badge already hidden (`BlastRadiusCard.tsx:122`).
- File path with `#`, spaces or unicode: `githubBlobUrl` encodes segments (`github-urls.test.ts:31`).
- Index sha force-pushed off the default branch: GitHub may 404 the blob; accepted, documented in Risks.
- `degraded` with `reason: null` (cannot happen after D4, but the type allows it): badge shows only `state.degraded`, no Resync.
- Resync on a repo with no clone: the index run persists `degraded/no_data` again; the badge stays. PrepareOverview's clone action is the fix there.
- Resync returns 202 `coalesced` or `degraded: true, reason: 'no_handler'` (`repo-intel/routes.ts:25-30,70-71`): still a success; readiness shows no change, the badge stays.
- MCP: a PR with hundreds of changed symbols returns every group (≤ 20 callers each). See Risks.

## Risks & rollback

| Risk | Impact | Mitigation |
|---|---|---|
| CHECK constraint swap on `pr_blast_cache` | migration fails on a row violating the new CHECK | the new list is a superset, so no row can violate it; generated by drizzle-kit (step 2) |
| Branch migration numbering vs `main` | `db:migrate` silently skips (`server/INSIGHTS.md:118`) | check `meta/_journal.json` order before merge; renumber with `drizzle-kit generate` if main moved |
| `resolvePr` side effect: `GET /repos/:id/pulls` syncs GitHub and may queue up to 10 auto-brief LLM jobs (`specs/07-devdigest-mcp.md:126`) | an auto-allowed `get_blast_radius` can reach GitHub and spend money with `automatic_brief` on | `openWorldHint: true` (D9); README caveat next to the allow rule; not redesigned here (same as `get_findings`) |
| MCP payload size: no cap on group count | large context for big PRs; worst case estimate 100 groups × 20 callers ≈ 2 000 caller objects ≈ 150-200 KB JSON ≈ 40-50 k tokens, above Claude Code's default MCP output limit (`MAX_MCP_OUTPUT_TOKENS`, default 25 000; warning above 10 000), so the client would cut the result | route already caps 20 callers/symbol and sets `truncated`; README documents raising `MAX_MCP_OUTPUT_TOKENS` for large PRs; no group cap (human decision, OQ-1) |
| Prompt injection via symbol names / file paths (repo content) | the model could follow text planted in identifiers | data-only JSON fields; `next_step` is constant except the enum `reason`; the description says to treat them as data |
| Stale links when the default branch is rewritten | GitHub 404 | sha links are immutable otherwise; acceptable |
| Header overflow at ~460 px (`client/INSIGHTS.md:125`) | badge row wraps | badge on its own row, `whiteSpace: normal`; verify at 1440 px in step 10 |
| Two "reindex" CTAs for `index_partial` | mild UX duplication | D11 note; requirement-driven |
| SVG `<a>` behaviour differs across browsers (focus ring, `rel`) | weaker keyboard affordance; `rel` possibly ignored | UA default focus ring accepted; the target is always github.com; step 10 checks focus + `window.opener` |
| Removing `debug` lines | less detail at debug level | the `info` line carries a superset of the fields |

**Rollback:** revert the branch commits. The migration is additive (a column with a default and a wider CHECK); leaving it applied after a code revert is harmless (old code ignores the column, the old enum values remain allowed). To fully revert the DB, drop the column and restore the old CHECK by regenerating from the reverted schema (`pnpm db:generate`), never by hand.

## Untrusted inputs

| Input | Source | Sink | Control |
|---|---|---|---|
| caller `file`, `name`, `symbol`, endpoint/cron strings | repository content via the indexer | React text, `href` | JSX escaping; `href` = `https://github.com/…` built by `githubBlobUrl` with every segment `encodeURIComponent`'d, so no `javascript:` URL is possible; `rel="noopener noreferrer"` |
| `repoFullName` | repo record from the API | `href` | same builder |
| same strings | route response | MCP `structuredContent` → model context | data-only fields; description flags them as data; no interpolation into `next_step` or messages |
| `reason` | server enum | MCP `next_step` | parsed against the shared enum in `PrBlastLite` before interpolation |
| log fields | counts, ids, short sha | Pino | no paths, no PR text |

No shell, SQL or LLM sink is added. The new SQL is only drizzle-generated DDL.

## Relevant INSIGHTS entries

- `client/INSIGHTS.md:109,193` — client imports only types from `@devdigest/shared` → D13 local tuple.
- `client/INSIGHTS.md:125` — Overview card content width ~460 px → D12.
- `client/INSIGHTS.md:148` — missing namespace only logs `MISSING_MESSAGE` → step 9 grep.
- `client/INSIGHTS.md:63` — Tree ↔ Graph swap and `ScrollFadeRegion` observers: do not restructure the scroll region when adding links.
- `server/INSIGHTS.md:80` — `ERR_PNPM_IGNORED_BUILDS` → `sh node_modules/.bin/…` fallback.
- `server/INSIGHTS.md:118` — migration watermark after merging `main`.
- Root `INSIGHTS.md:66` — the SDK validates `structuredContent` only after `listTools` → contract tests keep `connect()`'s `listTools`.
- Root `INSIGHTS.md:97,99` — mcp tsconfig `zod` mapping and stdio launcher: untouched.

## Open questions

- **OQ-1 (CLOSED, human).** No cap; MCP `downstream` 1:1 with the route; README explains `MAX_MCP_OUTPUT_TOKENS` (Risks).
- **OQ-2 (CLOSED, human: yes).** → D15, AC-19, AC-20, sites 36-38.
- **OQ-3 (CLOSED, human: yes).** `repo` and `pr_number` in the MCP output → D9, AC-12, site 17.
- **OQ-4 (CLOSED).** ADR 0026 wording → change site 35 (`doc-writer`).
- **OQ-5 (CLOSED, human: out of scope).** Pluralise the server `summary` string ("changed symbol(s)", `domain.ts:70-72`)? It reaches MCP verbatim. Out of scope by default (server copy, not `blast.json`).

## Review log

| Round | Reviewer | Finding | Severity | Resolution |
|---|---|---|---|---|
| 1 | plan-critic | PC-1 "no callers" state never renders (downstream holds zero-caller groups) | MAJOR | fixed in Problem table, AC-4, sites 27/32, Test plan |
| 1 | plan-critic | PC-2 `source` undefined on cache hit | MINOR | fixed in D8 (`blastSource(key)`), AC-10 |
| 1 | plan-critic | PC-3 fast-resync race | MINOR | fixed in D11, site 28, AC-11, Test plan (seed readiness `in_flight`) |
| 1 | plan-critic | PC-4 literal readiness key | MINOR | fixed in site 28 (`overviewReadinessKey`) |
| 1 | plan-critic | PC-5 MCP payload cap | MINOR | fixed in Risks (worst case + `MAX_MCP_OUTPUT_TOKENS`), site 24; cap stays OQ-1 |
| 1 | plan-critic | PC-6 MonoLink placement ambiguous | MINOR | fixed in site 33 |
| 1 | plan-critic | OQ: pluralise server summary | open question | OQ-5 |
| 1 | architecture-reviewer | AR-1 ADR 0026 "seven pairs" drift | LOW | fixed: change site 35 (doc-writer), OQ-4 closed |
| 1 | architecture-reviewer | OQ: how hit path computes `source`; D4 row 4 is a race | open question | fixed in D8, Test plan row AC-5 |
| 1 | architecture-reviewer | OQ: use `overviewReadinessKey` | open question | fixed in site 28 |
| 2 | plan-critic | PC-7 second `downstream.length` check at `BlastRadiusCard.tsx:78` | MINOR | fixed in site 32 |
| 2 | plan-critic | PC-8 hook test cannot observe the idle transition | MINOR | fixed in Test plan row AC-11 |
| 2 | plan-critic | PC-9 AC-10 test row vs D8 `reparse` | MINOR | fixed in Test plan row AC-10 |
| 2 | architecture-reviewer | AR-2 cross-domain readiness cache seed (temporal coupling, inconsistent `in_flight`) | LOW | fixed: site 28a `markOverviewIndexRunStarted` in `hooks/overview.ts`, D11, Test plan, step 8 |
| 2 | architecture-reviewer | OQ: is `isBusy` true when the 202 returns? | open question | answered in D11: reservation is synchronous (`repo-intel/service.ts:186-193`) |
| 3 | architecture-reviewer | AR-3 graph link accessible name drops the visible label (WCAG 2.5.3) | MEDIUM | fixed in D15, AC-19, Test plan (`name:line (file)`) |
| 3 | architecture-reviewer | OQ: D9 `repo` wording ambiguous | open question | fixed in D9 (`full_name`) |
