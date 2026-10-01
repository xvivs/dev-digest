# Research: PR Overview tab, design vs implementation

Sources. Design: `/Users/vladyslav.semenov/Downloads/DevDigest Design.html`. The artboard `pr-overview` is `<window.ScreenPRDetail blastView="tree" tab="overview" h={1180}/>` (1440x1180). The markup is not inline: the file is a bundler with a base64+gzip asset manifest (`__bundler/manifest`). I decoded it (44 assets) into the scratchpad. JSX sources used:
- `screen_pr_detail.jsx` (asset 89858a9a): `OverviewTab`, `BriefCard`, `IntentBlock`, `RiskPillRow`, `HistoryAccordion`
- `blast.jsx` (dffcee83): `BlastRadius`, `BlastRadiusSummary`, `BlastRadiusTree`
- `ui` (3bd77c7f): `SectionLabel`, `Card`, `Badge`
- `d0caa2b3`: `VerdictBanner`
- `3e72a0ef`: mock `INTENT`
- Tokens: the `<style>` block of the HTML, around lines 600-713.

`data-dc-slot="pr-overview"` does NOT occur in the file (0 matches of `data-dc-slot`). The artboard id `pr-overview` was used instead.
Code: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/` (abbreviated `OT/` below).

## Design structure

Page wrapper (`OverviewTab`): `padding: 20px 28px 40px; maxWidth: 1080; margin: 0 auto`. A single `<section>` holds `SectionLabel(FileText) "PR Brief"` followed by `BriefCard`.

`BriefCard` is a flex column with gap 16:
1. **VerdictBanner**: full width, flex gap 16, padding 16, radius 10, `1px solid var(--border)`, bg `--bg-elevated`.
   - 40x40 icon tile (radius 9, `--crit-bg`/`--ok-bg`/`--info-bg`).
   - Label 16/700, coloured. `Badge` "6 findings · 2 blockers".
   - Summary 13.5/1.55 `--text-secondary`.
   - Right column: CircularScore 52, "PR SCORE" 10.5 muted, CostBadge.
2. **Grid** `1fr 1fr`, gap 16, with TWO cards, one per column.
   - Left card: Intent, then a divider, then Risk areas.
   - Right card: Blast radius, then a divider, then History accordion.
   - No separate cards for Risk or History.

Card (`Card`): bg `--bg-elevated`, `1px solid var(--border)`, **radius 8**, padding `var(--card-pad)` (regular=16, compact=12, comfy=22).

SectionLabel: flex, gap 8, mb 12. Icon 14 `--text-muted`. Text **11px / 700 / letter-spacing 0.07em / uppercase / `--text-muted`**.

Divider between blocks: `height:1px; background: var(--border); margin: 16px 0`.

### Intent (detail)
- Header: SectionLabel(Target) "Intent". **No badge, no right slot.**
- Quote: `<p>` 14px / lineHeight 1.5 / **italic** / `--text-primary` / mb 14 / `text-wrap: pretty`. The text is wrapped in typographic quotes “…”. **No left bar, no blockquote, no accent border.**
- Scopes: `grid 1fr 1fr`, gap 18 (always 2 columns).
- Scope column header:
  - flex, gap 5, 11px / 700 / ls 0.04em, mb 7.
  - In scope: icon `Check` 13, colour `--ok`, text "IN SCOPE".
  - Out of scope: icon `X` 13, colour `--text-muted`, text "OUT OF SCOPE".
- Lists: `ul` with no style, flex column, gap 5.
- Items: `li` flex gap 7, 12.5px / lineHeight 1.45. A "·" bullet precedes the text, with mt 1.
  - In scope: text `--text-secondary`, bullet `--ok`.
  - Out of scope: text and bullet `--text-muted`.
- **Absent in the design** (searched `INTENT`, `IntentBlock`, the whole `screen_pr_detail.jsx`): confidence badge, stale badge, derive/refresh button, "Sources", "Links not read", "Derivation cost", low-confidence hint, opacity dimming. The mock `INTENT` has only `intent`, `in_scope`, `out_of_scope` (`3e72a0ef:28-40`).

### Risk areas (in the left card, under Intent)
- Label: SectionLabel(AlertTriangle) "Risk areas".
- Pill row: flex, gap 7, wrap.
- Pill (`button`): padding 5/10, **radius 6**, 12px / 500, `1px solid var(--border)`, **transparent bg**, text `--text-secondary`. The severity icon (13) is coloured `--crit`/`--warn`/`--info`. **No severity word, no tinted bg.**
- Active pill: border = severity colour, bg `--bg-hover`.
- Detail panel: mt 10, padding 10/12, radius 7, `1px solid var(--border)`, bg `--bg-surface`, anim ddpop .15s.
  - Explanation 12.5/1.55 `--text-secondary` (mdLite).
  - Below it, MonoLink file refs, gap 6, mt 8.

### Blast radius (in the right card)
- Label: SectionLabel(Workflow) "Blast radius".
- Controls row (flex, mb 10):
  - Left, inline stats (gap 16, 12.5px). Each is icon 13 `--text-muted` + `<b class="tnum">` 650 `--text-primary` + label. Items: Code "symbols", CornerDownRight "callers", Globe "endpoints", Clock "cron".
  - Right: tree/graph toggle, `margin-left:auto`, bg `--bg-surface`, `1px solid var(--border)`, radius 7, padding 2. Buttons 3/10, 11.5px / 600, radius 5, capitalised. Active: bg `--bg-elevated`, text `--text-primary`; inactive: muted.
- Tree: column, gap 2. Symbol row:
  - padding 5/6, radius 6, click toggles, open bg `--bg-hover`.
  - ChevronRight 13 (rotates 90 when open), Code 13 `--accent`, name `mono 12.5/600 "sym()"`, "N callers" 11px muted right-aligned.
  - Open body: padding `4px 0 8px 14px`. Callers are TreeRow (CornerDownRight, 12.5px, connector lines `--border-strong`, MonoLink `file:line`). Endpoints are mono Badges with Globe, accent-text on accent-bg. Crons are mono Badges with Clock, warn on warn-bg.
- Graph: SVG 560x230, caption "● changed symbol / callers / endpoints affected" 11px muted.

### History (right card, under Blast)
- Accordion: `1px solid var(--border)`, radius 7. Header padding 9/12, bg `--bg-surface` when open.
  - History 14 muted, "Prior PRs touching these files" **12.5/600** (not uppercase), Badge with count, ChevronDown right.
- Open: rows padding 10/14 with a timeline dot and `#N` mono accent-text, title 13/600, author avatar + "·" + merged_at 11.5 muted, notes 12.5/1.5.

### Tokens (dark, `<style>` ~L609-640)
- Backgrounds: `--bg-primary #0a0a0a`, `--bg-surface #141414`, `--bg-elevated #1c1c1c`, `--bg-hover #242424`.
- Borders: `--border #2a2a2a`, `--border-strong #3a3a3a`.
- Text: `--text-primary #ededed`, `--text-secondary #999`, `--text-muted #6a6a6a`.
- Accent: `--accent #3b82f6`, `--accent-text #93bbfc`.
- Status: `--ok #10b981`, `--warn #f59e0b`, `--crit #ef4444`, `--info #6b7280`.
- Density: `--card-pad` 12/16/22 (L711-713).

### Not found in the design
- An "empty / no agent runs" state of the Brief. The design has no EmptyState in `BriefCard`, and the VerdictBanner is always rendered with mock data.
- A "Description" (PR body) block. The design's `OverviewTab` ends after `BriefCard`.
- Mobile / narrow breakpoints of the Overview. The design is fixed at 1440.

## Current implementation

Mounted at `src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/_components/PrDetailContent/PrDetailContent.tsx:115` (`tab === "overview" && prId && <OverviewTab prId pr/>`) inside `s.body` (`PrDetailView/styles.ts:12-20`: padding `24px 32px 44px`, gap 24, maxWidth 1080).

`OT/OverviewTab.tsx:18-41`:
- Root: flex column, gap 20 (`OT/styles.ts:4`).
- `<BriefSection/>` at full width (L24).
- `s.grid` (`styles.ts:5-10`): `repeat(auto-fit, minmax(min(340px,100%),1fr))`, gap 20, `alignItems:start`. Left column `s.col` (gap 20) holds `IntentCard` and `RiskAreas` as separate cards. Right column holds `BlastRadiusCard` and `PriorPrs` as separate cards.
- Optional `Description` box (`pr.body`, L33-38, `styles.ts:12-21`, i18n `prReview.overview.description`).

| Section | File:line | How it renders / data |
|---|---|---|
| Review brief | `OT/_components/BriefSection/BriefSection.tsx:18-79` | `usePrRuns(prId)` + `usePrReviews(prId)` (L20-21); `selectLatestBrief(runs, reviews)` (L23; `OT/helpers.ts:25-46`, newest `done` run with a persisted review). States: error L32, loading Skeleton L34, **empty L36-37 `EmptyState icon=Sparkles title=t("noRun") body=t("unavailableHint")`**, else `VerdictBanner` + "newer run" notice. Always wrapped in `<section><SectionLabel icon="Sparkles">t("section")</SectionLabel>` (L73-77). Strings: `messages/en/brief.json:19-20` = "Review brief" / "No completed review yet". |
| Intent | `OT/_components/IntentCard/IntentCard.tsx:77-141` | `usePrIntent`; card = `shared.card` (`OT/styles.ts:22-28`: radius 10, padding 18). Badge confidence (L85-87; colours `OT/constants.ts:38-42`), stale badge and Refresh button (L88-89), blockquote (L102; `IntentCard/styles.ts:7-15`: 15px, `borderLeft: 3px solid var(--accent)`, padding `4px 0 4px 14px`, not italic), low hint (L103), scopes `flex wrap gap 20` min 180px (L105-108; `styles.ts:16-17`), plain-text labels 12px/600 muted (`styles.ts:19-24`), items 13px (`styles.ts:26`), Sources block (L110-120), Links not read (L122-135), cost line (L137-140), `lowCard` opacity .8 (`styles.ts:6`, L80). |
| Risks | `OT/_components/RiskAreas/RiskAreas.tsx:16-150` | Own card, label "Risks" (`brief.json:5`, `Shield` icon). Pills (`RiskAreas/styles.ts:8-23`): radius 99, 13px/600, severity-tinted bg, severity word (`s.sev`). |
| Blast radius | `OT/_components/BlastRadiusCard/BlastRadiusCard.tsx:23-121` | `usePrBlast`. Toggle sits inside the SectionLabel `right` slot (L80-91; `styles.ts:5-19`, active = accent-bg). Stats are 4 columns with a 20px number over a muted label (L104-111; `styles.ts:20-22`). Tree/Graph in `_components/BlastTree`, `BlastGraph`. "based on index" badge (L115-119). |
| Prior PRs | `OT/_components/PriorPrs/PriorPrs.tsx:12-80` | Own card with a Disclosure. Heading is uppercase 12px/700/0.07em (`PriorPrs/styles.ts:5-11`), title `t("history.title")`. |

State sources: `usePrRuns` is `src/lib/hooks/reviews.ts:49-57` (key `["pr-runs", prId]`, `GET /pulls/:id/runs`, `server/src/modules/reviews/routes.ts:104-107`, any status). `usePrReviews` is `reviews.ts:60-72`. Neither is deduplicated with PrDetailContent: it calls the same hooks (`PrDetailContent.tsx:54`, and `usePrReviews` at L46), so they share the query cache and no extra request is made.

`client/README.md` and `client/INSIGHTS.md` have nothing specific to Overview/Intent styling. INSIGHTS.md:281 only records "Shipped the Overview tab ... Desktop is the supported target; narrow-width gaps tracked in #10". Related general entries are at INSIGHTS.md:109 (sticky offset) and :115 (chevrons).

## Gap table

| Section | Design | Now | File:line | Concrete change |
|---|---|---|---|---|
| Brief (empty) | No empty-state block; Brief is a verdict banner | Big empty `Sparkles` section "REVIEW BRIEF / No completed review yet" | `BriefSection.tsx:36-37,73-77` | Return `null` when there are no runs (see Empty-state logic). Hide the label with it (`SectionLabel` is inside the same return). |
| Brief label | "PR Brief" (FileText), once above the whole brief | "Review brief" (Sparkles) | `BriefSection.tsx:75`, `brief.json:19` | Optional: rename the string; low priority. |
| Layout | 1 VerdictBanner, then grid `1fr 1fr` gap 16 with **2 cards** (Intent+Risks / Blast+History, divider 16px between) | Auto-fit grid, gap 20, **4 separate cards**, `alignItems:start` | `OverviewTab.tsx:25-35`, `styles.ts:5-11` | Wrap each column in a single card; between blocks use `1px` divider with `margin:16px 0`; grid `1fr 1fr` gap 16. Keep a `min` collapse for narrow widths (design has none, so that is an extension; INSIGHTS.md:281 notes narrow-width work). |
| Card | radius 8, pad `--card-pad` (16) | radius 10, pad 18 | `styles.ts:22-28` | radius 8, `padding: var(--card-pad)`. Inner blocks drop their own card chrome. |
| Intent quote | 14px, italic, no bar, in “ ” | 15px, non-italic, 3px accent left bar, no quotes | `IntentCard/styles.ts:7-15`, `IntentCard.tsx:102` | Remove `borderLeft` and the left padding; `fontSize:14; fontStyle:"italic"; lineHeight:1.5; margin:"0 0 14px"`; render `“{intent.intent}”`. Keeping a `<blockquote>` for semantics is fine. |
| Intent header | Label only | Label + confidence badge + stale badge + Refresh button | `IntentCard.tsx:81-94` | Drop the badge/right slot for the compact look (confidence is not in the design). Open decision, see Unknowns. Stale/Refresh/failure notice are functional states: keep them only when `stale` or `failure`. |
| Scope columns | grid `1fr 1fr` gap 18, header with `Check` (`--ok`) / `X` (muted), 11px/700/0.04em UPPERCASE | flex wrap, gap 20, plain muted 12px/600 labels, no icons | `IntentCard/styles.ts:16-24`, `IntentCard.tsx:154-170` | Use grid `1fr 1fr` gap 18 (add `minmax(0,1fr)`); header with `Icon.Check`/`Icon.X` 13, text from `intent.inScope` / `outOfScope` uppercased, mb 7. |
| Scope items | 12.5px/1.45, "·" bullet; in-scope secondary + `--ok` bullet; out-of-scope all muted | 13px/1.5 secondary, no bullet | `IntentCard/styles.ts:26`, `IntentCard.tsx:163-165` | `fontSize:12.5; lineHeight:1.45; display:flex; gap:7`, "·" span; out-of-scope colour `--text-muted`; list gap 5 (now 6, `styles.ts:25`). |
| Intent extras | Not in design | Sources, Links not read, Derivation cost, low hint, opacity .8 | `IntentCard.tsx:103,110-140`, `styles.ts:6,18,27` | Remove from the card face; if the data is still wanted, put it in a collapsed Disclosure ("Details") or in the trace. Needs the user's call. |
| Risk pills | radius 6, 12px/500, border-only, transparent, colour on icon only, no severity word | radius 99, 13px/600, tinted bg + text colour, severity word | `RiskAreas/styles.ts:8-29`, `RiskAreas.tsx:98-108` | Restyle per design; keep `aria-label`/text for severity if the a11y rule "never colour alone" (`constants.ts:31`) must hold, e.g. `title` or visually hidden text. |
| Risk detail box | radius 7, padding 10/12, 12.5/1.55 | radius 8, padding 14, 13px | `RiskAreas/styles.ts:30-43` | Align the numbers. |
| Risks as own card | Part of the Intent card, label "Risk areas" | Own card, label "Risks" | `OverviewTab.tsx:28`, `brief.json:5` | Render inside the left card; rename label to "Risk areas" or keep "Risks". |
| Blast header | Inline stats (icon + bold number + label, gap 16, 12.5px); toggle in the same row, bg-surface | Toggle in SectionLabel right; stats as 4 big columns (20px number over label) | `BlastRadiusCard.tsx:80-111`, `styles.ts:5-22` | Put stats and toggle on one row (`flex`, toggle `margin-left:auto`); stat = `Icon 13 + <b> + label` 12.5px; toggle container bg `--bg-surface`, radius 7, padding 2; active = bg `--bg-elevated` + `--text-primary`. Add icons Code, CornerDownRight, Globe, Clock. |
| Blast "based on index" | Not in design | Badge under the graph | `BlastRadiusCard.tsx:115-119` | Keep or drop; user's call. |
| Prior PRs | Accordion inside the Blast card, below a divider, title "Prior PRs touching these files" 12.5/600 not uppercase, border 1px radius 7 | Own card, uppercase 12px/700 heading "Prior PRs" | `PriorPrs.tsx:57-76`, `PriorPrs/styles.ts:5-11` | Render inside the right card after the divider; title `fontSize:12.5; fontWeight:600; textTransform:none`; add i18n string "Prior PRs touching these files". |
| Description box | Not in design | Shown when `pr.body` | `OverviewTab.tsx:33-38` | Not found in the design. Decide with the user (keep as is). |
| Spacing | page padding 20/28/40, section gaps 16 | body 24/32/44, root gap 20 | `PrDetailView/styles.ts:12-20`, `OT/styles.ts:4` | Differences are small; change only if pixel parity is required. |

## Empty-state logic

- Hook: `usePrRuns(prId)` (`src/lib/hooks/reviews.ts:49-57`) returns `RunSummary[]` (`src/vendor/shared/contracts/trace.ts:118-143`). The endpoint returns runs of any status, including failed ones (`server/src/modules/reviews/routes.ts:103-107`).
- "No agent runs" = `runs.isSuccess && runs.data.length === 0`.
- Placement in `BriefSection.tsx`: `const noRuns = runs.data?.length === 0;`, then `if (noRuns) return null;` before the final `return`, after the hooks (L20-23). Do not hide while `runs.isLoading` (keeps the skeleton) and do not hide on `isError` (keeps the retry).
- Alternative, stricter reading: hide when `!brief` (no done run with a persisted review, `helpers.ts:25-46`). That would also hide the section while a first run is `running`/`failed`, losing the "newer run" notice and the failed state. I recommend the first condition (`length === 0`) and keep the existing `noRun` empty state (L36-37) for runs that exist but none is completed. Both options are your call, see Unknowns.
- Layout effect: with the section gone, `OverviewTab` root (`gap: 20`) starts directly with the grid. No change needed in `OverviewTab.tsx`; alternatively gate in the parent with `usePrRuns` (already fetched at `PrDetailContent.tsx:54`), but this widens the change surface.
- Tests: no existing test references `BriefSection`, `noRun` or "Review brief" (grep over `src` tests found only `helpers.test.ts` for `selectLatestBrief`). A behaviour test for "no runs => no Review brief heading" would be new.

## Unknowns

- Whether the confidence badge, stale badge and Refresh/Derive controls should survive the "design-like" Intent. The design shows none; they are functional (Settings auto-brief, derive failures). I propose: keep only the stale/failure notice and Refresh when relevant, and drop the confidence badge for high confidence (inference, not from the design).
- Where Sources, Links not read and Derivation cost should go (delete, collapse, or trace). Not in the design.
- The design has no narrow layout, so the existing `auto-fit` collapse (INSIGHTS.md:281, issue #10) cannot be checked against it.
- Light-theme values were not extracted (only dark tokens quoted); the code uses the same CSS variables, so parity there is not a concern.
- Whether `/pulls/:id/runs` can return non-review runs (e.g. derivation) that would make `length === 0` false even though no review exists: I did not read `service.listRuns`. Verify before relying on it.
- `data-dc-slot="pr-overview"` literally does not exist in the HTML; I used the artboard `id="pr-overview"`.
- Visual verification in a browser was not done (read-only research).
