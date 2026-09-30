# Spec: Smart Diff (Files changed grouped by role, findings inline)

**Status:** draft, reviewed (rounds 1-3; plan-critic ACCEPT, architecture-reviewer APPROVE; see Review log) · **Branch:** `feat/smart-diff`, stacked on `9c789c2` (which carries the pr-overview commits) · **Approach:** brainstorm Option 1 revised by the orchestrator (NEW D1):
- the pure classifier `classifyFile` and its constants live in `reviewer-core/src/smart-diff/`, exported from the package entry, so the server run-executor, the L08 prompt filter and the CI runner can import it without HTTP, DB or container;
- the grouping / `finding_lines` builder is a pure `server/src/modules/reviews/domain.ts`, called by `ReviewService.smartDiff` and served by `GET /pulls/:id/smart-diff` in `reviews/routes.ts`, reading only persisted data;
- the client joins roles to `pr.files` by path and derives every finding mark from `usePrReviews`, so counters, dots, stripes and cards come from one source.

Inputs (scratchpad, not committed): `smart-diff-brief.md` (verbatim lab brief and its ACs) and `smart-diff-design.md` (values extracted from the prototype). **Precedence:** the brief wins on functionality (the inline finding card, the tests and docs roles, the GitHub order for "Original order"); the prototype wins on visuals everywhere else. Every claim below was re-checked against the code on 2026-09-30.

## Problem & Motivation

The Files changed tab (`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:24-76`) renders `pr.files` in GitHub order through one `DiffViewer` (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:14-32`). A lock file sits next to business logic, and nothing marks which files the agents flagged. Findings live only on the Agent runs tab (`FindingsPanel.tsx:36,103` → `FindingCard`), so matching a finding to code means switching tabs.

The scaffolding exists but nothing uses it:
- the `SmartDiff` contract with a three-value `SmartDiffRole` (`server/src/vendor/shared/contracts/brief.ts:166-199`; the client copy is byte-identical, `diff -rq server/src/vendor/shared client/src/vendor/shared` prints nothing);
- `SmartDiffResponse = SmartDiff` (`contracts/review-api.ts:139-141`, both copies);
- the `prReview.smartDiff` i18n keys (`client/messages/en/prReview.json:71`: `coreLabel`, `wiringLabel`, `boilerplateLabel`, `largeTitle`, `largeBody`, `filesCount`, `findingLines`, `groupedByRole`), none referenced from `client/src`.

No classifier and no route exist: `grep -rni smartdiff server/src client/src reviewer-core/src` finds only the contracts and `client/src/lib/types.ts:35`.

## Goals / Non-goals

### Goals

1. In Smart order, Files changed always shows all five role groups in the fixed order core → tests → wiring → docs → boilerplate. Each has a colour square, label, description and file count; once a review exists, also the number of its files with findings. Empty groups are muted, say "0 files" and cannot be expanded.
2. The docs and boilerplate groups and their file cards start collapsed. An "Original order" segment restores the GitHub order.
3. Findings appear in the diff:
   - a red dot after the path on the file card, separate from the GitHub comment counter;
   - a 3px severity stripe on every covered line and a lowercase severity label on the start line;
   - the Agent runs `FindingCard` under `RIGHT:start_line`, with working Accept / Dismiss;
   - a block at the end of the file for findings that match no rendered line, and a block after the last group for findings on paths not in the PR.
4. `classifyFile` is pure, lives in `reviewer-core`, keeps its patterns and role order in one `constants.ts`, and needs no Fastify, DB or container.
5. Viewing Smart Diff makes no model call and no GitHub call, and grouping works before the first review.
6. New UI matches the prototype values in the Visual spec table.

### Non-goals

- `pseudocode_summary`, the "summary" pill and the "What this does:" strip. They need a model call; the field stays absent (`nullish`).
- A real `split_suggestion`: it is `too_big: false`, `total_lines` = Σ(additions + deletions), `proposed_splits: []`. The split banner (`largeTitle` / `largeBody`) is not rendered.
- Changing the Agent runs tab, `FindingCard`'s look, or the PR-list FINDINGS column.
- Wiring the classifier into `run-executor.ts` or the prompt (L08). This spec only makes it importable.
- Making `GET /pulls/:id` transactional or ordered (Risks R1, R4).
- Linking the in-diff `FindingCard`'s `file:line` to GitHub. `MonoLink` renders without `href` when `repoFullName` / `headSha` are absent (`FindingCard.tsx:49-52`).
- Changing `SectionLabel` (`client/src/vendor/ui/primitives/SectionLabel.tsx:15-27`, fs 12 / mb 14 vs the prototype's 11 / 12). It is a shared primitive used across the app.
- Hover styles the prototype does not define (segments, group header, lines). Global `:focus-visible` still applies.

### Decisions

**D1 — Classifier in `reviewer-core` (orchestrator decision, binding).**

| Option | + | − |
|---|---|---|
| **`reviewer-core/src/smart-diff/` (chosen)** | pure by the package's own rules (`reviewer-core/AGENTS.md` "Zero I/O"); the server already consumes reviewer-core pure logic (`server/src/modules/reviews/helpers.ts:8-10`); the L08 prompt filter and the CI runner get it without a server import (reviewer-core `INSIGHTS.md`, Codebase Patterns: "a pure function needed by both reviewer-core and server belongs in reviewer-core") | the client cannot import it (no alias in `client/tsconfig.json`), so the client relies on the route for roles |
| `server/src/modules/reviews/smart-diff/` (round 0) | next to its first consumer | nested files escape every depcruise layer regex (`server/.dependency-cruiser.cjs:22-28`), needing a gate change; L08 in reviewer-core would have to move it again |
| Vendored `@devdigest/shared` | client classifies locally | logic duplicated in two copies with no sync script |

Layout:
- `reviewer-core/src/smart-diff/constants.ts`: `ROLE_ORDER`, `CLASSIFY_ORDER`, `ROLE_PATTERNS` (D3);
- `reviewer-core/src/smart-diff/classify.ts`: `classifyFile(path: string): SmartDiffRole`;
- `reviewer-core/src/index.ts`: a new "Smart diff" export block with `classifyFile`, `ROLE_ORDER`, `CLASSIFY_ORDER`, `ROLE_PATTERNS`.

`SmartDiffRole` is `import type` from `@devdigest/shared`, which reviewer-core resolves to the server's vendored copy (`reviewer-core/tsconfig.json:22-23`; runtime alias `reviewer-core/vitest.config.ts:9`). Core purity P1-P7 (`.claude/agents/architecture-reviewer.md:63-69`): no I/O (P1), no LLM (P2), contracts from `@devdigest/shared` (P6), hermetic test in `reviewer-core/test/` (P7). P3-P5 do not apply.

**D2 — The builder is `server/src/modules/reviews/domain.ts` (new, flat).** It holds `selectLatestPerAgent` and `buildSmartDiff` over plain shapes. The file name matches the existing `DOMAIN` regex (`.dependency-cruiser.cjs:23`), so `domain-is-pure`, `domain-no-runtime-zod` and `application-no-fastify` (`:63-68,99-126`) cover it with **no gate change**. Round 0's depcruise edit (old step 4, AR-1, AR-2) is dropped.

| Option | + | − |
|---|---|---|
| **`reviews/domain.ts` (chosen)** | gated by three existing rules for free; the onion layer map puts pure invariants in `domain.ts` | first `domain.ts` in `reviews`, so it holds only smart-diff logic for now |
| `reviews/smart-diff.ts` (orchestrator's example) | self-describing name | matches no layer regex, so purity is review-only |
| `reviews/helpers.ts` | exists, gated by `mapper-is-pure` | that file maps rows to DTOs (`helpers.ts:1-4`); grouping is a rule, not a mapper |

`domain.ts` imports `classifyFile` and `ROLE_ORDER` as values from `@devdigest/reviewer-core` and `SmartDiff` / `SmartDiffRole` as types from `@devdigest/shared`. reviewer-core is treated as a pure kernel, the same way `helpers.ts:10` already imports it. **Flag for the architecture reviewer:** the onion-architecture layer table lists no reviewer-core import for the domain ring; this is the first one. No ADR proposed: it follows the reviewer-core INSIGHTS pattern and adds no outward dependency.

**D3 — Two orders, one file.** `reviewer-core/src/smart-diff/constants.ts` holds:
- `ROLE_ORDER` (display): `core, tests, wiring, docs, boilerplate`;
- `CLASSIFY_ORDER` (matching, first match wins): `boilerplate, tests, wiring, docs`; anything else is `core`;
- `ROLE_PATTERNS: Record<Exclude<SmartDiffRole, 'core'>, readonly RegExp[]>`.

The patterns are `RegExp` literals, each with its glob in a comment. Neither reviewer-core nor the server depends on a glob library (`grep -E 'picomatch|minimatch' reviewer-core/package.json server/package.json` finds nothing), and 25 patterns do not justify a supply-chain entry. Every regex is anchored and linear: no nested quantifiers, no backreferences.

A "segment" match means the pattern matches at the path start or right after a `/`.

| Role | Patterns (brief, verbatim) | How matched |
|---|---|---|
| boilerplate | `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `dist/**`, `build/**`, `**/__snapshots__/**`, `*.snap`, `*.generated.*`, `*.min.js` | basename for names and extensions; `dist/` and `build/` **only at the path start** (as the brief writes them; OQ-1); `__snapshots__/` as any segment |
| tests | `**/*.test.ts(x)`, `**/*.it.test.ts`, `**/*.spec.ts`, `**/test/**`, `**/tests/**`, `**/__tests__/**`, `e2e/**` | basename for the suffixes; `test/`, `tests/`, `__tests__/` as any segment; `e2e/` at the path start |
| wiring | `index.ts`, `index.js`, `*.config.*`, `tsconfig*.json`, `.eslintrc*`, `.env*`, `docker-compose*.yml`, `.github/**`, `.claude/**` | basename for the files; `.github/` and `.claude/` at the path start |
| docs | `**/*.md`, `docs/**`, `README*`, `CHANGELOG*`, `LICENSE` | basename for the extension and names; `docs/` at the path start |

`classifyFile` strips one leading `./` before matching and does not rewrite `\` (GitHub paths are POSIX).

**D4 — The three contested cases (human-approved), pinned in T-1:**

| Path | Role | Why |
|---|---|---|
| `src/__tests__/__snapshots__/x.snap` | **boilerplate** | boilerplate is matched before tests; a snapshot is generated output |
| `.claude/skills/security/SKILL.md` | **wiring** | wiring is matched before docs; this markdown configures agent behaviour |
| `e2e/README.md` | **tests** | brief order kept: `e2e/**` is a tests pattern and tests are matched before docs |

**D5 — Findings = latest review per agent (human-approved).** For each `agent_id` (null is its own key), the newest review by `created_at`, and all its findings of any `kind`. `reviewsForPull` already returns reviews newest first (`server/src/modules/reviews/repository/review.repo.ts:57-66`); both implementations still pick by `created_at`, not by array position.

The rule is implemented twice: `selectLatestPerAgent` in `server/src/modules/reviews/domain.ts` and `selectDiffFindings` in `DiffTab/helpers.ts`. **Accepted debt (AR-3):** there is no automated drift check. The client copy carries a header in the style of `client/src/lib/blockers.ts:1-7`: "client copy of server `selectLatestPerAgent` (`server/src/modules/reviews/domain.ts`); keep the two rules identical". The UI never reads `finding_lines` (D8), so a drift cannot make the screen disagree with itself; it can only make the route disagree with the UI. Future alternative: a persisted `superseded` flag on reviews, set when an agent re-runs, would let both sides filter on one column. Out of scope.

**D6 — Dismissed findings (human-approved).** A finding with `dismissed_at != null` still renders its muted card (`FindingCard.tsx:53-55`). It does **not** count toward the file dot, the group counter or the server's `finding_lines`, and gets **no** stripe or label. Accepted findings count. One predicate per package: `isActiveFinding`.

**D7 — One shared visibility toggle (human-approved).** Findings are shown by default; GitHub comments keep their current hidden default (`DiffTab.tsx:28-29`). `DiffTab` holds `showOverride: boolean | null`, initially `null`:
- effective `showComments = showOverride ?? false`;
- effective `showFindings = showOverride ?? true`;
- the button renders when comments + findings > 0 (today only comments, `DiffTab.tsx:59`);
- labels: `null` → `diff.showAll` "Show all ({count})"; `true` → `diff.hideCommentsAndFindings`; `false` → `diff.showCommentsAndFindings`, where `count` = comments + active findings; a click sets `true` from `null`, otherwise flips;
- **no-comment case (PC-7):** when `commentCount === 0`, the `null` state already shows everything, so it is treated as `true`: the label is `diff.hideCommentsAndFindings` and a click sets `false`. Offline, comments are always `[]` (`server/src/modules/pulls/routes.ts:356,362`), so this is the common demo case (#482). `toggleLabel(state, { commentCount, findingCount })` encodes it;
- "findings" in the render condition means **all** diff findings from D5, dismissed included, so a PR with only dismissed (muted) cards can still hide them; the `count` in the label counts active findings only;
- posting a comment still sets `true` (`DiffTab.tsx:41`);
- with no findings the button keeps `diff.showComments` / `diff.hideComments`, so today's comment-only behaviour and `e2e/specs/05-pr-diff.flow.json` are unchanged.

The toggle hides cards (inline and both unmatched blocks) and comment threads. Stripes, labels, dots and counters stay.

**D8 — The server returns roles; the client joins by path.**
- The route always returns **all five groups** in `ROLE_ORDER`, some with `files: []`. The client renders all five too (PC-1).
- The client groups `pr.files` (from `usePullDetail`, the same array Original order shows) by the role the response gives each path. A path missing from the response falls back to `core` (`FALLBACK_ROLE`). Within a group, files keep `pr.files` order.
- The client uses `finding_lines` for **nothing**. Counters, dots, stripes and cards all come from `usePrReviews` + D5, which is already invalidated after a run (`useRunReview` `reviews.ts:181-185`, `useRefreshRunState` `:93-101`) and after a finding action (`useFindingAction` `:208-213`). So no smart-diff invalidation after a review run is needed. If a later feature reads `finding_lines`, it must add `["smart-diff", prId]` to those three invalidations.
- `usePrSmartDiff(prId, headSha)` uses the key `["smart-diff", prId, headSha]` (AR open question). `head_sha` is a non-null string (`contracts/platform.ts:168`). A head move re-keys the query as soon as the detail refetch returns the new `head_sha` (for example `useRefreshPullForBrief`, `client/src/lib/hooks/brief.ts:62-68`), so `brief.ts` needs no change. The `core` fallback covers the window before that. The global client already sets `refetchOnWindowFocus: false` (`client/src/lib/query-client.ts:49`).
- While the smart-diff query is loading or has failed, the tab renders the flat Original-order list. On failure it also shows the muted note `smartDiff.groupingFailed`, and the Smart segment is disabled.

**D9 — Injecting the card: a component slot, not a render function.** `src/components/diff-viewer` must not import the route's `_components/FindingCard` (frontend-architecture: nothing reaches into a route's `_components`). The viewer gets an optional prop next to `commenting`:

```ts
interface DiffFindingApi {
  findings: FindingRecord[];            // already filtered by D5
  show: boolean;                        // D7 effective showFindings
  Card: React.ComponentType<DiffFindingCardProps>;
  onAction: (finding: FindingRecord, action: FindingActionKind) => void;
  pendingId: string | null;
}
interface DiffFindingCardProps { finding: FindingRecord; onAction: (action: FindingActionKind) => void; pending: boolean }
```

`Card` is the module-level `DiffTab/_components/DiffFindingCard`, which renders `FindingCard` with `defaultExpanded` (react-best-practices, Render Factories). `DiffTab` owns the single `useFindingAction()` instance. `onAction(finding, action)` calls `mutation.mutate({ findingId: finding.id, action, prId })`, exactly like `FindingsPanel.tsx:103`. Passing `prId` is what triggers the `["reviews", prId]` invalidation (`reviews.ts:209`); without it the card never refetches (PC-5). `pendingId = mutation.isPending ? mutation.variables?.findingId ?? null : null`. `FindingCard` is already a `Disclosure` (`FindingCard.tsx:59`), so the P3 "collapse to one line" comes free.

**D10 — Generic keyed partition.** `partitionThreads` (`comments.ts:90-108`) becomes a wrapper over a new pure `partitionByKey<T>(items, keyOf: (item: T) => string | null, renderedKeys)` in `diff-viewer/helpers.ts`. Findings use `keyOf = f => lineKey("RIGHT", f.start_line)` (`comments.ts:35`) with the same `renderedKeys` built from `keysForLine` (`comments.ts:64-75`). `comments.test.ts` stays green unchanged.

**D11 — Line marks.** A pure `lineMarks(lines, findings)` in a new `diff-viewer/findings.ts` returns `Map<lineKey, { severity; isStart; title }>`:
- every rendered **RIGHT** line (`add` or `ctx`) whose `newNo` lies in `[start_line, max(start_line, end_line)]` of an active finding gets a stripe;
- on overlap the worst severity wins, using the existing `SEVERITY_RANK` from `@devdigest/ui` (`client/src/vendor/ui/primitives/tokens.ts:34-37`, exported at `primitives/index.ts:2`), not a new table;
- `title` is the title of the finding that won the line (the stripe tooltip);
- the label is drawn only on the line whose key equals the finding's `RIGHT:start_line` (`isStart`).

Label text: `SEVERITY_LINE_LABEL_KEY: Record<FindingRecord["severity"], "blocker" | "warning" | "suggestion">` (the shared three-value severity, `contracts/findings.ts:11`; not the `@devdigest/ui` `Severity`, which adds `INFO`, `tokens.ts:11`) → `diffViewer.finding.*`. Colour and icon: `SEV[severity]` (`tokens.ts:16-24`).

**D12 — File and group open state.**
- `DiffViewer` keys `FileCard` by `file.path`, not the index (`DiffViewer.tsx:28`).
- `FileCard` gets `defaultOpen?: boolean`; when given, it replaces the `AUTO_EXPAND_MAX_LINES` heuristic (`FileCard.tsx:37-39`).
- `DiffTab` passes `defaultOpen={false}` for docs and boilerplate files (`COLLAPSED_ROLES`) in **both** order modes, `undefined` otherwise.
- Non-empty group `Disclosure`s for `COLLAPSED_ROLES` start closed; the others start open.
- Switching the order mode remounts the cards, so every file returns to its default. Accepted.
- The prototype opens a file only when it has findings; the brief's `AUTO_EXPAND_MAX_LINES` rule wins (functionality).

**D13 — i18n namespaces.** Group labels, descriptions, the header, the order control and empty states go into `prReview.smartDiff` (brief P3). Strings rendered inside `src/components/diff-viewer` go into `diffViewer` (a component used across route namespaces owns its namespace): `finding.{blocker,warning,suggestion}`, `findingsDot`, `unmatchedFindingsTitle`. `client/src/i18n/request.ts:16-25` loads every file in `messages/en`, so nothing is registered.

**D14 — Service placement.** `ReviewService.smartDiff(ws, prId): Promise<SmartDiff | undefined>` goes into `reviews/service.ts`. It does three reads through the repository the service already builds (`service.ts:34-35`): `getPull` (`repository.ts` → `pull.repo.ts:8-18`, workspace-scoped), `getPrFiles` (`repository.ts:47`), `reviewsForPull` (`repository.ts:76`). Row → plain-shape mapping goes into two pure mappers in `reviews/helpers.ts`, `toSmartDiffFile(row)` and `toSmartDiffReview({ review, findings })`, with type-only row imports as at `helpers.ts:6` (onion `references/layers.md`: row → domain conversion lives in the repository or `helpers.ts`; `mapper-is-pure` gates it). The input shapes are defined in `domain.ts`. The service only chains reads → mappers → `buildSmartDiff`, as `reviewsForPull` does with `reviewToDto` (`service.ts:161-162`). Rows still reach the service from the repository (pre-existing). No new port or fake: the only logic is the pure builder, tested hermetically (onion-architecture `references/anti-patterns.md`, depth table: a read passthrough needs no port). The route turns `undefined` into `NotFoundError` (onion rule 2). **Accepted debt:** `ReviewService` still constructs `ReviewRepository` itself (pre-existing); no new runtime import.

**D15 — Visuals: prototype values, with four functional exceptions.** Every new element and the restyled diff-viewer follow the Visual spec table. The viewer's only consumer is `DiffTab` (`grep -rl components/diff-viewer client/src` outside the folder: `DiffTab.tsx`, `test/smoke.test.tsx`), so restyling it touches no other screen. Exceptions, each with its reason:
1. Line text keeps `whiteSpace: pre-wrap` (`diff-viewer/styles.ts:70-76`), not the prototype's `pre`. `fileCard` has `overflow: hidden` (`styles.ts:11`), so `pre` would clip long lines with no way to read them.
2. The page container stays the existing `PrDetailContent` body (`PrDetailView/styles.ts:15-22`: `maxWidth 1080`, centred, `padding 24px 32px 44px`). The prototype's `20px 28px 40px` wrapper is not nested inside it, because that would double the padding, and changing the shared body would move every tab.
3. `SectionLabel` stays as is (Non-goals).
4. "Original order" is `pr.files` order (brief: GitHub order), not the prototype's `path.localeCompare`.

**D16 — Sticky group header under the sticky PR header (PC-4).** `PrDetailHeader` is `position: sticky; top: 0; zIndex: 5; background: var(--bg-primary)` (`PrDetailHeader/styles.ts:4-10`) inside `<main style={{ overflow: auto, position: relative }}>` (`client/src/vendor/ui/shell/AppFrame.tsx:33`). A group header with `top: 0` would slide under it.

| Option | + | − |
|---|---|---|
| **Measured CSS variable (chosen)** | follows the real header height, which wraps on narrow widths (commit `cd3c17c`) | one `ResizeObserver` hook |
| Constant offset | no code | wrong as soon as the title or banner wraps |
| Group headers not sticky | nothing to measure | drops P3 AC-27 |

Mechanics:
- `PrDetailHeader` accepts a `ref` prop (React 19 ref-as-prop) on its root `div` (`PrDetailHeader.tsx:31`).
- `PrDetailContent` holds that ref plus a ref on its body `div` (`PrDetailContent.tsx:106`). A hook in `PrDetailContent/hooks/useStickyOffset.ts` (the `hooks/` subfolder convention of `client/src/components/app-shell/hooks/`) observes the header with `ResizeObserver` and writes `--pr-header-h: <height>px` on the body element through `style.setProperty`. No React state, so a resize re-renders nothing. It disconnects on unmount. **Timing:** `PrDetailContent` returns the skeleton before the header mounts, so a mount-only effect would see a null ref and never attach. The hook therefore returns **callback refs** (`setSource`, `setTarget`) that attach and detach the observer whenever the nodes appear or change, instead of taking `RefObject`s. Both callbacks are `useCallback(…, [])`-stable and keep their nodes in `useRef`, so a `PrDetailContent` re-render does not disconnect and reconnect the observer (react-best-practices, `useCallback` case 3). `ResizeObserver` is stubbed in tests (`client/src/test/setup.ts:3-9`).
- The variable name lives in a new route-level `app/repos/[repoId]/pulls/[number]/constants.ts` (`PR_HEADER_OFFSET_VAR`). Two sibling features under one route share it, so it sits at the route level (frontend-architecture promotion rule), and neither feature imports the other's internals.
- The sticky style goes on `Disclosure`'s `headerStyle`, i.e. the row `div` (`Disclosure.tsx:86`), never on content inside the header slot: that slot sits inside the `<button>`, which would become the containing block and nothing would stick (PC-11). For an empty group, the static row `div` carries the same style.
- The group header style: `position: sticky`, `top: var(--pr-header-h, 0px)`, `zIndex: 4` (below the PR header's 5), `background: var(--bg-primary)` so cards do not show through (design OQ-5).
- No ancestor between the group header and `<main>` may set `overflow` (sticky would break). The group wrapper style sets none.

**D17 — Resolutions of the design file's "Not in prototype / open questions".**

| # | Design question | Decision |
|---|---|---|
| 1 | No inline card in the prototype | Brief wins: `FindingCard` inline under `RIGHT:start_line` (D9), plus the prototype's stripe and label (D11) |
| 2 | Empty groups; no tests/docs names, colours, descriptions | All five groups always render; empty ones muted (opacity .5), "0 files", no chevron, not a button. Tests/docs colours, labels and descriptions defined in the Visual spec |
| 3 | `pseudocode_summary` | Out of scope (Non-goals) |
| 4 | Hover / ARIA | No hover styles added. Segments are `<button type="button" aria-pressed>` in a `role="group"` labelled `smartDiff.orderLabel`; non-empty group headers are `Disclosure` buttons (`aria-expanded`); dots have `role="img"` + `aria-label` |
| 5 | Sticky header has no background or offset | `--bg-primary` background, `top: var(--pr-header-h)`, `zIndex 4` (D16) |
| 6 | Hard-coded summary; dot always `--crit` | Summary computed from `files` (count, Σ additions, Σ deletions). The file dot stays `--crit` as in the prototype; severity lives on the lines |
| 7 | Line label 10.5px; CRITICAL reads "blocker" | Prototype size kept; "blocker" per brief |
| 8 | Original order sorted by path | `pr.files` order (brief; D15.4) |
| 9 | Loading, error, binary, hunk rows, responsive | Loading/error: flat list (+ `groupingFailed` on error). Binary / `patch: null`: existing `noDiffText`, findings in the end-of-file block. Hunk rows keep `s.hunk` (`styles.ts:54-60`). Responsive: the header row gets `flexWrap: wrap`, so the segmented control drops under the summary on narrow widths |

**D18 — Summary counts come from `files`.** `DiffTab` drops the `filesCount` prop (today it feeds `diff.title`, `DiffTab.tsx:71`). The summary is `files.length` files, Σ `additions`, Σ `deletions`, so it always equals the sum of the groups. On seeded #482 that reads 4 files, while the PR header's `files_count` says 9 (the seed stores a subset, `server/src/db/seed.ts:413-419`). **Assumed**; OQ-3.

## Acceptance criteria (EARS)

*Classifier and contract*
- **AC-1** `reviewer-core/src/index.ts` shall export a pure `classifyFile(path: string): SmartDiffRole` implemented in `reviewer-core/src/smart-diff/classify.ts`. It shall return the role of the first `CLASSIFY_ORDER` entry whose pattern matches, else `core`. The `smart-diff/` files shall import only each other and `import type` from `@devdigest/shared`.
- **AC-2** `ROLE_ORDER`, `CLASSIFY_ORDER` and `ROLE_PATTERNS` shall be defined only in `reviewer-core/src/smart-diff/constants.ts`.
- **AC-3** When `classifyFile` is called with `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` or `Cargo.lock`, it shall return `boilerplate`.
- **AC-4** When `classifyFile` is called with the three D4 paths, it shall return `boilerplate`, `wiring` and `tests` respectively.
- **AC-5** `SmartDiffRole` shall be `z.enum(['core','tests','wiring','docs','boilerplate'])` in both `server/src/vendor/shared/contracts/brief.ts` and `client/src/vendor/shared/contracts/brief.ts`, and the two `vendor/shared` trees shall be identical.

*Route*
- **AC-6** When `GET /pulls/:id/smart-diff` is called for a PR in the workspace, the system shall return 200 with a body validated by the route's `response: { 200: SmartDiffResponse }` schema, with exactly five groups in `ROLE_ORDER`.
- **AC-7** When the PR has no reviews, every file's `finding_lines` shall be `[]` and every persisted file shall appear in exactly one group.
- **AC-8** When reviews exist, a file's `finding_lines` shall be the distinct `start_line`s, ascending, of the active findings whose `file` equals the path, taken from the latest review per agent (D5, D6).
- **AC-9** `split_suggestion` shall be `{ too_big: false, total_lines: Σ(additions + deletions), proposed_splits: [] }`.
- **AC-10** While serving `GET /pulls/:id/smart-diff`, the system shall make no LLM call and no GitHub call.
- **AC-11** If the PR does not exist or is not in the caller's workspace, then the route shall return 404.

*Grouping and order (client)*
- **AC-12** When Files changed opens in Smart order with the smart-diff data loaded, the tab shall render all five groups in the order core → tests → wiring → docs → boilerplate, each with its colour square, label, description (`prReview.smartDiff`) and "N files".
- **AC-13** If a group has no files, then its header shall be muted, show "0 files", render no chevron and no button (no `aria-expanded`), and have no body.
- **AC-14** When Files changed opens, the docs and boilerplate groups and every file card in them shall be collapsed. Other file cards shall follow `AUTO_EXPAND_MAX_LINES`.
- **AC-15** When the user activates "Original order", the tab shall render one flat list in `pr.files` order with no group headers. "Smart order" shall restore the groups. The active segment shall carry `aria-pressed="true"`.
- **AC-16** If a path in `pr.files` is missing from the smart-diff response, then the file shall be shown in the core group.
- **AC-17** While the smart-diff query is loading or has failed, the tab shall render the Original-order list. On failure it shall also show `smartDiff.groupingFailed` and disable the Smart segment.

*Finding marks (client)*
- **AC-18** When reviews exist, each non-empty group header shall show a red dot and the number of its files with at least one active finding (2 files with 5 findings → 2). Dot and number shall be hidden when the number is 0.
- **AC-19** When a file has at least one active finding, its card header shall show a 6×6 `--crit` dot right after the path, with no number, `role="img"` and the label `diffViewer.findingsDot` ("N finding(s)"). The GitHub comment counter shall stay separate and unchanged.
- **AC-20** When a file with a finding is expanded and findings are shown, `FindingCard` (severity, title, rationale, Accept, Dismiss) shall render directly under the rendered line whose key is `RIGHT:<start_line>`.
- **AC-21** When an active finding covers rendered RIGHT lines, each such line shall carry a 3px left stripe in `SEV[severity].c` with the finding title as its tooltip, and keep its add/del background. The start line shall show the right-aligned label `blocker` / `warning` / `suggestion` for CRITICAL / WARNING / SUGGESTION.
- **AC-22** When the user clicks Accept or Dismiss on an in-diff card, the client shall `POST /findings/:id/accept|dismiss` with `prId` in the mutation variables, and after the `["reviews", prId]` refetch the card shall show the new state. A dismissed finding shall stop counting and lose its stripe (D6).
- **AC-23** If a finding matches no rendered line of its file (deleted line, outside the patch, `patch: null`), then it shall render in a block at the end of that file's body, titled `diffViewer.unmatchedFindingsTitle`.
- **AC-24** If a finding's `file` matches no path in `pr.files`, then it shall render in a block after the last group (or after the flat list), titled `prReview.smartDiff.unmatchedFilesTitle`.
- **AC-25** When the user toggles visibility off, finding cards (inline and both blocks) and GitHub comment threads shall be hidden together; stripes, labels, dots and counters shall stay (D7).
- **AC-26** While findings exist and the user has not touched the toggle, findings shall be shown and GitHub comments hidden (D7).

*P3 (deliver if cheap; each independent)*
- **AC-27 (P3)** While the list scrolls, each group header shall stick directly below the sticky PR header, on a `--bg-primary` background, and never above it (D16).
- **AC-28 (P3)** When the user activates an in-diff card's header, the card shall collapse to its one-line header without dismissing the finding.
- **AC-29 (P3)** While `usePrReviews` has returned `[]`, the header shall show `smartDiff.reviewNotRun` and no counters.
- **AC-30 (P3)** When a review run finishes or a finding action succeeds, counters, dots, stripes and cards shall update without a reload, through the existing `["reviews", prId]` invalidation.
- **AC-31 (P3)** Every group name, description and header string shall come from `client/messages/en/prReview.json` → `smartDiff`, with `testsLabel` and `docsLabel` added.

*Visual and cross-cutting*
- **AC-32** The new and restyled elements shall use the values in the Visual spec table, checked by a style review of `styles.ts` files and the browser pass in step 10.
- **AC-33** `cd server && pnpm arch:check` shall report no new violations, and `reviews/domain.ts` shall be matched by `domain-is-pure`.
- **AC-34** No finding or PR string shall be rendered as raw HTML. Rationale and suggestion go through `FindingCard`'s `<Markdown safe>` (`FindingCard.tsx:89,95`); the stripe tooltip is a React `title` attribute.
- **AC-35** The Agent runs tab, `e2e/specs/05-pr-diff.flow.json` and `e2e/specs/04-pr-findings.flow.json` shall pass unchanged.

## Visual spec (prototype values, PC-3)

Every token below exists in `client/src/vendor/ui/styles.css` (dark / light line numbers): `--bg-primary` 11/52, `--bg-surface` 12/53, `--bg-elevated` 13/54, `--border` 15/56, `--text-primary` 17/58, `--text-secondary` 18/59, `--text-muted` 19/60, `--accent` 20/61, `--crit` 26/67, `--warn` 28/69, `--sugg` 30/71, `--ok` 35/76, `--code-add` 44/85, `--code-del` 45/86, `--code-add-text` 46/87, `--code-del-text` 47/88. The prototype's values match these tokens one to one (design file, "Token mapping").

| Element | Values | Where |
|---|---|---|
| Section label | `SectionLabel icon="Code"`, text `smartDiff.groupedByRole` = "Reviewer-ordered diff" (uppercased by the primitive); toggle button (D7) in its `right` slot | DiffTab |
| Header row | flex, alignItems center, flexWrap wrap, gap 8, marginBottom 14 | `DiffTab/styles.ts` |
| Summary | fs 12.5, `--text-secondary`; `smartDiff.summaryFiles` "{count} files ·" then `+A` mono `--code-add-text` and `−D` (U+2212) mono `--code-del-text` | `DiffTab/styles.ts` |
| Segmented container | marginLeft auto, display flex, gap 2, background `--bg-surface`, border 1px solid `--border`, borderRadius 7, padding 2; `role="group"` + `aria-label` `smartDiff.orderLabel` | `OrderToggle/styles.ts` |
| Segment button | padding 3px 11px, fs 11.5, fontWeight 600, borderRadius 5, border none; active: background `--bg-elevated`, color `--text-primary`; inactive: transparent, `--text-muted`; disabled (AC-17): opacity .5, cursor default. Copy `smartOrder` "Smart order", `originalOrder` "Original order" | `OrderToggle/styles.ts` |
| Group wrapper | marginBottom 18; no `overflow` | `SmartDiffGroup/styles.ts` |
| Group header | flex, alignItems center, gap 9, padding 6px 0, marginBottom 8; sticky per D16 (`top: var(--pr-header-h, 0px)`, zIndex 4, background `--bg-primary`) | `SmartDiffGroup/styles.ts` |
| Group chevron (non-empty only) | `Icon.ChevronRight` 13, reuse `chevronFor(open)` rotation (`diff-viewer/styles.ts:152-158`) | SmartDiffGroup |
| Group square | 8×8, borderRadius 2, flexShrink 0, background = role colour | `SmartDiffGroup/styles.ts` |
| Role colours | core `--accent`; tests `--ok`; wiring `--warn`; docs `--text-secondary`; boilerplate `--text-muted`. Tests/docs chosen because `--sugg` / `--accent-text` are the core blue again, `--info` (#6b7280) is indistinguishable from `--text-muted` (#6a6a6a), and `--crit` is reserved for finding dots | `DiffTab/constants.ts` `ROLE_META` |
| Group label / desc / count | label fs 12.5, w700, `--text-primary`; desc fs 11.5, `--text-muted`; count `smartDiff.filesCount` fs 11, `--text-muted`, tnum, marginLeft auto | `SmartDiffGroup/styles.ts` |
| Group findings counter | before the count: dot 6×6 borderRadius 99 `--crit` + number fs 11 w600 tnum `--crit`, gap 4; `role="img"`, `aria-label` `smartDiff.filesWithFindings` | `SmartDiffGroup/styles.ts` |
| Empty group | header opacity .5, no chevron, no button, count "0 files", no body | `SmartDiffGroup/styles.ts` |
| File list | flex column, gap 8 | `diff-viewer/styles.ts` `s.list` (was 10) |
| File card | border 1px `--border`, borderRadius 7, background `--bg-elevated` (unchanged) | `s.fileCard` |
| File header | padding 8px 11px, gap 8 (was 10px 12px / 10); order: chevron 13 · FileText 14 · path · finding dot · right cluster (marginLeft auto, gap 8): comment counter, then `+N −M` | `s.fileHeader`, FileCard |
| File path | mono, fs 12.5 (was 13), w500, ellipsis, `flex: 0 1 auto` so the dot sits right after it | `s.filePath` |
| File finding dot | 6×6, borderRadius 99, `--crit`, flexShrink 0; `title` + `aria-label` `diffViewer.findingsDot` | `s.findingDot` (new) |
| +/− counts | mono tnum fs 11.5 (was 12); `--code-add-text` / `--code-del-text` | `s.fileStat` |
| Code body | borderTop 1px `--border`, padding 6px 0 (was 8px 0), background `--bg-surface` | `s.fileBody` |
| Code line | fs 12 (was 13), lineHeight 20px, position relative; add `--code-add`, del `--code-del`, ctx transparent | `lineRowFor` |
| Line number | width 44, right-aligned, paddingRight 8 (was 10), `--text-muted` | `s.lineNo` |
| Sign column | width 14, centred; add `--code-add-text`; del and ctx `--text-muted` (del was red) | `lineSignFor` |
| Code text | `--text-primary`, paddingRight 10 (was 12); keeps `pre-wrap` (D15.1) | `s.lineText` |
| Line stripe | position absolute, left 0, top 0, bottom 0, width 3, background `SEV[sev].c`, `title` = winning finding title; row keeps its add/del background | `lineStripeFor(color)` (new) |
| Line label | inline-flex, alignItems center, gap 4, paddingRight 10, fs 10.5, w600, colour `SEV[sev].c`, `Icon[SEV[sev].icon]` size 11, lowercase word, no background, no border | `s.lineLabel` (new) |
| No-snippet body | padding 14px 16px (was 14px 18px), fs 12 (was 13), `--text-muted`, centred; copy stays `noDiffText` | `s.noDiff` |
| Inline finding card rail | margin 6px 14px 8px 58px, flex column gap 8 (same rail as `cs.thread`, `styles.ts:108-113`); card = `FindingCard` unchanged | `cs.thread` reused |
| Unmatched blocks | same as `cs.outdatedWrap` / `cs.outdatedTitle` (`styles.ts:134-148`) | reused |

Copy (`client/messages/en/prReview.json` → `smartDiff`):

| Key | Value |
|---|---|
| `groupedByRole` (value changed) | `Reviewer-ordered diff` |
| `coreLabel` (value changed) | `Core logic` |
| `testsLabel` (new) | `Tests` |
| `wiringLabel` | `Wiring` |
| `docsLabel` (new) | `Docs` |
| `boilerplateLabel` | `Boilerplate` |
| `coreDescription` | `The substance of the change — review closely` |
| `testsDescription` | `Proves the change works — check what it covers` |
| `wiringDescription` | `Hooks the core into the app` |
| `docsDescription` | `Explains the change — read for intent` |
| `boilerplateDescription` | `Generated / mechanical — skim` |
| `filesCount` (value changed) | `{count, plural, one {# file} other {# files}}` (prototype is always plural; "1 files" is a grammar bug, so ICU plural; `0 files` unchanged) |
| `summaryFiles` | `{count, plural, one {# file} other {# files}} ·` |
| `smartOrder` / `originalOrder` / `orderLabel` | `Smart order` / `Original order` / `File order` |
| `filesWithFindings` | `{count, plural, one {# file} other {# files}} with findings` |
| `reviewNotRun` | `Review not run yet — findings will appear here` |
| `groupingFailed` | `Couldn’t group files by role; showing the original order.` |
| `unmatchedFilesTitle` | `{count, plural, one {# finding} other {# findings}} on files not in this diff` |

`prReview.diff`: `showAll` `Show all ({count})`, `showCommentsAndFindings` `Show comments & findings ({count})`, `hideCommentsAndFindings` `Hide comments & findings ({count})`.

`client/messages/en/diffViewer.json`: `finding.blocker` `blocker`, `finding.warning` `warning`, `finding.suggestion` `suggestion`, `findingsDot` `{count, plural, one {# finding} other {# findings}}`, `unmatchedFindingsTitle` `{count, plural, one {# finding} other {# findings}} outside the shown lines`.

## Change sites

| # | File | Change | Layer | AC | Risk |
|---|---|---|---|---|---|
| 1 | `server/src/vendor/shared/contracts/brief.ts:167` + `client/src/vendor/shared/contracts/brief.ts:167` | `SmartDiffRole` → 5 values, byte-identical | core (contracts) | 5 | twin drift |
| 2 | `reviewer-core/src/smart-diff/constants.ts` (new) | `ROLE_ORDER`, `CLASSIFY_ORDER`, `ROLE_PATTERNS` (D3); `import type { SmartDiffRole }` | core (pure) | 2-4 | pattern order = behaviour |
| 3 | `reviewer-core/src/smart-diff/classify.ts` (new) | `classifyFile(path)`: strip one leading `./`, first match | core (pure) | 1,3,4 | regex cost |
| 4 | `reviewer-core/src/index.ts` | "Smart diff" export block: `classifyFile`, `ROLE_ORDER`, `CLASSIFY_ORDER`, `ROLE_PATTERNS` | core (entry) | 1 | — |
| 5 | `reviewer-core/README.md` → "Public API" | one sentence listing the smart-diff exports | docs | 1 | — |
| 6 | `server/src/modules/reviews/domain.ts` (new) | `selectLatestPerAgent(reviews)`, `buildSmartDiff(files, reviews): SmartDiff` over plain shapes (`{ path, additions, deletions }`, `{ agent_id, created_at, findings: { file, start_line, dismissed_at }[] }`); calls `classifyFile`, iterates `ROLE_ORDER` | domain | 6-9 | policy twin (D5) |
| 7 | `server/src/modules/reviews/service.ts` (after `reviewsForPull`, `:149-163`) | `smartDiff(ws, prId)` (D14) | application | 6-11 | — |
| 7a | `server/src/modules/reviews/helpers.ts` | `toSmartDiffFile(row)`, `toSmartDiffReview({ review, findings })` (D14), type-only row imports | mapper | 6-8 | — |
| 7b | `server/src/modules/reviews/repository.ts:47` | `export type PrFileRow = typeof t.prFiles.$inferSelect`, used by `getPrFiles` and `toSmartDiffFile` (matches `FindingRow` / `PullRow` / `ReviewRow`, `helpers.ts:6`) | infrastructure (type) | 6 | — |
| 8 | `server/src/modules/reviews/routes.ts:10-17,128-132` | docblock line; `app.get('/pulls/:id/smart-diff', { schema: { params: IdParams, response: { 200: SmartDiffResponse } } }, …)`, `undefined` → `NotFoundError` | presentation | 6,10,11 | — |
| 9 | `client/src/lib/hooks/reviews.ts` | `usePrSmartDiff(prId, headSha)`: key `["smart-diff", prId, headSha]`, `api.get<SmartDiffResponse>(…, SmartDiffResponse)` value-imported from `@devdigest/shared/contracts/review-api` (ADR 0007; client INSIGHTS "import the contract subpath"), `enabled: !!prId`, `placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === prId ? prev : undefined)` so a `headSha` re-key of the same PR keeps the previous grouping instead of flashing back to the flat list (PC-12), while a different PR never inherits another PR's roles (PC-13) | client (server state) | 16,17 | new key tuple |
| 10 | `client/src/components/diff-viewer/helpers.ts` + `comments.ts:90-108` | `partitionByKey<T>`; `partitionThreads` delegates (D10) | client (domain) | 23 | comment regression |
| 11 | `client/src/components/diff-viewer/findings.ts` (new) + `constants.ts` | `DiffFindingApi`, `DiffFindingCardProps` (type-only React import; the file header says so, unlike `comments.ts:1-5` "No React here"), `findingKey`, `findingsForFile`, `isActiveFinding`, `lineMarks` (D11); `SEVERITY_LINE_LABEL_KEY` | client (domain) | 19-23 | — |
| 12 | `client/src/components/diff-viewer/styles.ts` | restyle per Visual spec; add `findingDot`, `lineStripeFor(color)`, `lineLabel`, `statCluster` | client (styles) | 19,21,32 | visual regression only |
| 13 | `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx` | props `findings?: DiffFindingApi`, `defaultOpenFor?: (path: string) => boolean \| undefined`; `key={f.path}` | client | 14,20 | — |
| 14 | `client/src/components/diff-viewer/FileCard/FileCard.tsx` | `defaultOpen` prop; header order per Visual spec + dot; findings partition via `partitionByKey`; marks + matched findings to `CodeLine`; `UnmatchedFindings` rendered also when `lines.length === 0` | client | 14,19,20,23,25 | `noDiff` branch |
| 15 | `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` | props `mark?`, `findings?`, `findingApi?`; stripe + start-line label inside the row; cards after comment threads when `findingApi.show` | client | 20,21,25 | row layout |
| 16 | `client/src/components/diff-viewer/UnmatchedFindings/` (new: `UnmatchedFindings.tsx`, `index.ts`) | end-of-file block, mirrors `OutdatedComments` | client | 23 | — |
| 17 | `client/src/components/diff-viewer/index.ts` | export types `DiffFindingApi`, `DiffFindingCardProps` and the values `isActiveFinding`, `findingsForFile`; nothing outside the folder imports a deep diff-viewer path | client | — | — |
| 18 | `client/messages/en/diffViewer.json` | keys per Visual spec | client (i18n) | 19,21,23 | missing key only logs |
| 19 | `client/src/app/repos/[repoId]/pulls/[number]/constants.ts` (new, route level) | `PR_HEADER_OFFSET_VAR = "--pr-header-h"` | client | 27 | — |
| 20 | `…/_components/PrDetailHeader/PrDetailHeader.tsx:25,31` | accept `ref?: React.Ref<HTMLDivElement>` on the root | client | 27 | — |
| 21 | `…/_components/PrDetailView/_components/PrDetailContent/PrDetailContent.tsx:96-128` + `hooks/useStickyOffset.ts` + `hooks/index.ts` (new, as `components/app-shell/hooks/`) | callback refs from `useStickyOffset` on header and body (D16); pass `headSha={pr.head_sha}` to `DiffTab`, drop `filesCount` | client | 16,27 | — |
| 22 | `…/_components/DiffTab/constants.ts` (new) | `ROLE_META: Record<SmartDiffRole, { labelKey; descKey; color }>` (lookup only, not an order), `COLLAPSED_ROLES`, `FALLBACK_ROLE = "core"`, `ORDER_MODES` | client | 12,14,16 | — |
| 23 | `…/_components/DiffTab/helpers.ts` (new) | `selectDiffFindings(reviews)` (D5 + flatten, header per AR-3), `groupFilesByRole(files, smartDiff)` iterating `SmartDiffRole.options` value-imported from `@devdigest/shared/contracts/brief` (all five, `isEmpty`; no client order literal), uses `isActiveFinding` / `findingsForFile` from `@/components/diff-viewer`, `countFilesWithFindings`, `unmatchedFileFindings`, `summarize(files)`, `toggleLabel(state, counts)` | client (domain) | 12,13,16,18,24,26 | policy twin |
| 24 | `…/_components/DiffTab/styles.ts` (new) | header row, summary | client (styles) | 32 | — |
| 25 | `…/_components/DiffTab/_components/OrderToggle/` (new: `OrderToggle.tsx`, `styles.ts`, `index.ts`) | segmented control (Visual spec) | client | 15,17 | — |
| 26 | `…/_components/DiffTab/_components/SmartDiffGroup/` (new: `SmartDiffGroup.tsx`, `styles.ts`, `index.ts`) | non-empty: `Disclosure` with chevron, square, label, desc, counter, count, body = `DiffViewer`; empty: static muted row | client | 12-14,18,27 | sticky vs overflow |
| 27 | `…/_components/DiffTab/_components/DiffFindingCard/` (new: `DiffFindingCard.tsx`, `index.ts`) | module-level adapter → `../../../FindingCard` with `defaultExpanded` (D9) | client | 20,22,28 | — |
| 28 | `…/_components/DiffTab/DiffTab.tsx` | props `{ prId, headSha, files, canComment }`; `usePrReviews`, `usePrSmartDiff`, one `useFindingAction`; order mode state; D7 toggle; header; groups or flat list; AC-24 block; AC-29 state | client | 12-18,22,24-26,29,30 | component size (split into 22-27) |
| 29 | `client/messages/en/prReview.json` → `smartDiff`, `diff` | keys per Visual spec | client (i18n) | 12,24,26,29,31 | missing key only logs |

Tests are listed under Test plan. No migration: no table or column changes (`findings`, `reviews`, `pr_files` already hold every field read). No new dependency.

## Steps

In this environment, prefix `pnpm` with `pnpm_config_verify_deps_before_run=false` if the preflight install fails (root INSIGHTS, Tool & Library Notes). The orchestrator stages explicit paths only.

1. **Baseline.** Record the pre-change state so a later red is attributable.
   Verify: `(cd reviewer-core && pnpm typecheck && pnpm test) ; (cd server && pnpm typecheck && pnpm arch:check && pnpm test) ; (cd client && pnpm typecheck && pnpm test)` → save the pass/fail counts per package in the PR notes.
2. **Contract.** Site 1, both copies identically.
   Verify: `diff -r server/src/vendor/shared client/src/vendor/shared && (cd server && pnpm typecheck) && (cd client && pnpm typecheck) && (cd reviewer-core && pnpm typecheck)` → empty diff, all exit 0.
3. **Classifier in reviewer-core, table first.** Write `reviewer-core/test/smart-diff-classify.test.ts` (T-1), watch it fail, then sites 2-5.
   Verify: `cd reviewer-core && pnpm typecheck && pnpm exec vitest run test/smart-diff-classify.test.ts && grep -nE "^import" src/smart-diff/*.ts` → pass; the grep shows only `./constants.js` and `import type … '@devdigest/shared'` (AC-1).
4. **Server domain builder.** Write `server/test/reviews-smart-diff-domain.test.ts` (T-2), then site 6.
   Verify: `cd server && pnpm exec vitest run test/reviews-smart-diff-domain.test.ts && pnpm arch:check` → pass, exit 0.
5. **Service + route.** Sites 7, 7a, 7b, 8, then `server/test/reviews-smart-diff.it.test.ts` (T-3).
   Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/reviews-smart-diff.it.test.ts test/reviews.it.test.ts && pnpm arch:check` → pass. Docker is required; the `.it` suite skips silently without it (`dockerAvailable()`), so confirm the report lists the tests as run, not skipped.
6. **Client hook + viewer pure helpers.** Sites 9, 10, 11; tests T-4, T-5.
   Verify: `cd client && pnpm typecheck && pnpm exec vitest run src/components/diff-viewer/comments.test.ts src/components/diff-viewer/helpers.test.ts src/components/diff-viewer/findings.test.ts` → pass; `git diff --quiet -- client/src/components/diff-viewer/comments.test.ts` exits 0.
7. **Viewer components + restyle.** Sites 12-18; test T-6.
   Verify: `cd client && pnpm typecheck && pnpm exec vitest run src/components/diff-viewer src/test/smoke.test.tsx 2>&1 | tee /tmp/sd-7.log; ! grep -q MISSING_MESSAGE /tmp/sd-7.log` → pass, no missing messages.
8. **DiffTab domain.** Sites 22, 23; test T-7.
   Verify: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/helpers.test.ts"` → pass.
9. **Composition, sticky offset, i18n.** Sites 19-21, 24-29; test T-8.
   Verify: `cd client && pnpm typecheck && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]" 2>&1 | tee /tmp/sd-9.log; ! grep -q MISSING_MESSAGE /tmp/sd-9.log` → pass (includes the unchanged `FindingCard`, `FindingsPanel`, `PrDetailView` suites).
10. **Full gate + browser.** Stop the dev app first (root INSIGHTS: `e2e.sh` shares `client/.next`).
    Verify: `(cd reviewer-core && pnpm typecheck && pnpm test) && (cd server && pnpm typecheck && pnpm arch:check && pnpm test) && (cd client && pnpm typecheck && pnpm test) && ./scripts/e2e.sh` → all green; `04-pr-findings` and `05-pr-diff` pass unchanged. Then the manual browser pass (user CLAUDE.md: a passing typecheck is not a working feature), using the demo data below:
    - **#482** (`acme/payments-api`, seeded review): counters and dots. Its `pr_files` have **no patch** (`server/src/db/seed.ts:413-419`), so all four findings land in end-of-file blocks; no stripe or inline card can show here. Expected: core group "4 files" with counter 3 (`src/config.ts`, `src/api/users.ts`, `src/middleware/ratelimit.ts`), tests/wiring/docs/boilerplate "0 files" and muted, Original order, the toggle (label "Hide comments & findings (4)", since #482 has no comments offline), Accept in an end-of-file block showing the accepted state (accepted still counts, D6), and **Dismiss** dropping the core counter from 3 to 2 after refetch when it hits the only finding of `src/config.ts`.
    - **#490** (`src/refunds/service.ts` + `src/refunds/service.test.ts`, real patches, `seed.ts:31-78,1076-1080`; no seeded review): inline card, stripe and label. Either run a review on #490 from the UI (needs an LLM key in `~/.devdigest/secrets.json`), or insert the demo rows via `psql` (every NOT NULL column, `server/src/db/schema/reviews.ts:42-57,86-95`):
      `WITH pr AS (SELECT id, workspace_id FROM pull_requests WHERE number = 490), r AS (INSERT INTO reviews (workspace_id, pr_id, kind) SELECT workspace_id, id, 'review' FROM pr RETURNING id) INSERT INTO findings (review_id, file, start_line, end_line, severity, category, title, rationale, confidence) SELECT id, 'src/refunds/service.ts', 6, 8, 'CRITICAL', 'bug', 'Demo: equality boundary untested', 'Demo finding for the Smart Diff browser check.', 0.9 FROM r;` New line 6 is `if (amount > payment.captured) {` in that hunk. Expected: stripes on lines 6-8, `blocker` on line 6, `FindingCard` under line 6, service.test.ts in the tests group.
    - **Sticky:** on #490, scroll `<main>`: each group header stops under the PR header, the PR header stays on top, cards do not show through; narrow the window until the PR title wraps and check again.
    - **Grouping spread:** the seeded self-PR with `specs/`, `docs/`, `server/test/` and `reviewer-core/test/` files (`seed.ts:1262-1267`) shows core, tests and docs populated.

## Test plan

| # | AC | Test file (exact path) | Kind | Case |
|---|---|---|---|---|
| T-1 | 1-4 | `reviewer-core/test/smart-diff-classify.test.ts` | unit | `it.each` table, path → role:<br>**boilerplate:** `pnpm-lock.yaml`, `client/package-lock.json`, `yarn.lock`, `Cargo.lock`, `dist/index.js`, `build/out.css`, `src/__snapshots__/a.snap`, `src/__tests__/__snapshots__/x.snap` (**contested**), `api.generated.ts`, `vendor/jquery.min.js`;<br>**tests:** `src/a.test.ts`, `src/A.test.tsx`, `server/test/reviews.it.test.ts`, `src/a.spec.ts`, `server/test/helpers/pg.ts`, `pkg/tests/x.ts`, `src/__tests__/a.ts`, `e2e/specs/05-pr-diff.flow.json`, `e2e/README.md` (**contested → tests**, comment citing D4);<br>**wiring:** `server/src/modules/index.ts`, `lib/index.js`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `.eslintrc.cjs`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.claude/skills/security/SKILL.md` (**contested**);<br>**docs:** `README.md`, `docs/adr/0005-x.md`, `specs/05-smart-diff.md`, `CHANGELOG.md`, `LICENSE`, `docs/diagram.png`;<br>**core:** `src/platform/config.ts`, `src/refunds/service.ts`, `src/latest/run.ts` (`test` inside a word is not a segment), `client/dist/app.js` (OQ-1, pinned), `./src/a.ts`; and `./pnpm-lock.yaml` → `boilerplate`.<br>Plus: a 4 096-character path of `a/` segments classifies in < 5 ms; `new Set([...CLASSIFY_ORDER, 'core'])` equals `new Set(ROLE_ORDER)`; `ROLE_ORDER` deep-equals `SmartDiffRole.options` (value import from `@devdigest/shared`, as `src/review/run.ts:12` does) |
| T-2 | 6-9 | `server/test/reviews-smart-diff-domain.test.ts` | unit (hermetic) | five groups in `ROLE_ORDER` even when empty; files keep input order within a group; `finding_lines` distinct and ascending; dismissed excluded, accepted included; a finding on a path not in the files is ignored; `total_lines` sum; `SmartDiffResponse.parse(result)` succeeds. **D5 table:** agent A old + new, agent B, `agent_id: null` old + new, given in shuffled order → only A-new, B and null-new count |
| T-3 | 6-8,10,11 | `server/test/reviews-smart-diff.it.test.ts` | `*.it.test.ts` (Testcontainers) | seeded #482: 200, 5 groups, `src/config.ts` in core with `finding_lines` containing 12; a test-inserted PR with `pnpm-lock.yaml`, `README.md`, `src/a.test.ts` and no reviews → the right groups, all `finding_lines: []`; `POST /findings/:id/dismiss` on the seeded `src/config.ts` finding, then 12 is gone; random uuid → 404; a PR in another workspace → 404. `buildApp` gets `github` and `llm` (all three ids) overrides whose every method throws and bumps a counter; counters stay 0 (AC-10). Pattern: `server/test/history-routes.it.test.ts:47-52` |
| T-4 | 23 | `client/src/components/diff-viewer/helpers.test.ts` (extend) | unit | `partitionByKey`: grouping by key, `null` key → unmatched, key not rendered → unmatched, input order kept |
| T-5 | 21,23 | `client/src/components/diff-viewer/findings.test.ts` (new) | unit | `lineMarks`: a range stripes every rendered RIGHT line in it, never `del`; overlap → worst severity and its title; `isStart` only on `start_line`; `end_line < start_line` → one line; dismissed → no mark; `findingsForFile` exact path match |
| T-6 | 14,19-21,23,25 | `client/src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx` (extend; new cases use `userEvent.setup()`) | RTL | stub `Card` (renders title + Accept calling `onAction`): card after line 3's row; start line shows `blocker` for CRITICAL; header has `role="img"` named "1 finding" and the comment counter is still present; a finding on line 99 lands under `unmatchedFindingsTitle`; `patch: null` still shows the block; `show: false` hides cards but keeps dot and label; `defaultOpenFor → false` renders the card with `aria-expanded="false"`; Accept → `onAction(finding, "accept")` |
| T-7 | 12,13,16,18,24,26 | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/helpers.test.ts` (new) | unit | `groupFilesByRole`: all five roles, order deep-equals `SmartDiffRole.options`, **empty groups kept with `isEmpty: true`**, missing path → core, `pr.files` order within a group; `selectDiffFindings` on the T-2 D5 rows; `countFilesWithFindings` (2 files / 5 findings → 2; dismissed-only file → 0); `unmatchedFileFindings`; `summarize`; `toggleLabel` for `null` / `true` / `false` × findings 0 / > 0 × comments 0 / > 0, including **comments 0 × findings > 0 × `null` → hide label, click → `false`** (PC-7) |
| T-8 | 12-18,20,22,24-26,29,30 | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx` (new) | RTL (`renderWithProviders` with `prReview` + `diffViewer`; `vi.mock("@/lib/api")` whose `get` parses through the schema it is given, client INSIGHTS) | Flow 1: files in core + tests only, one review → five headings in order; the wiring header reads **"0 files"** and contains **no element with `aria-expanded`**; docs/boilerplate collapsed; the core counter reads 1; "Original order" → flat list in `pr.files` order, no group headings, `aria-pressed` moves; the card is under the line; click Accept → `api.post` called with `/findings/<id>/accept`, **and** a `["reviews", prId]` refetch happens (`api.get` for `/pulls/<id>/reviews` called a second time), after which the card shows `finding.accepted`. Flow 2: `reviews: []` → `reviewNotRun`, no counters; then `queryClient.setQueryData(["reviews", prId], …)` → counter appears without remount (AC-30). Flow 3: smart-diff rejects → flat list, `groupingFailed`, Smart segment disabled. Flow 4: with comments, toggle `null → true → false` hides cards and comments together; without comments, the first click hides the cards |
| T-9 | 35 | `e2e/specs/05-pr-diff.flow.json`, `e2e/specs/04-pr-findings.flow.json` | e2e flow (existing, unchanged) | green under `./scripts/e2e.sh` |

AC-27 (sticky) and AC-32 (visuals) are checked in step 10's browser pass; jsdom has no layout. `useStickyOffset` has no unit test for the same reason (recorded, not hidden).

## Edge cases

- **Renamed files.** `pr_files.path` is the new path; findings cite the new path. Old-path findings go to the AC-24 block.
- **Binary or unfetched patch (`patch: null`).** `parsePatch` returns `[]`, `FileCard` shows `noDiffText`, and all the file's findings go to the end-of-file block (T-6). Seeded #482 is entirely this case.
- **Findings on deleted lines.** Findings anchor on the new-file `start_line`. A `del`-only line does not match, so the finding goes to the end-of-file block (T-5, T-6).
- **`end_line < start_line`.** One line (T-5).
- **Case.** Matching is case-sensitive like git paths, except `README*` / `CHANGELOG*` / `LICENSE`, which also match lowercase. `readme.md` hits `*.md` anyway.
- **Order switch** resets every card to its default open state (D12).
- **A file in the response but not in `pr.files`:** ignored; the client iterates `pr.files`.
- **All files in one role** (seeded #482): the four other groups render muted with "0 files"; `05-pr-diff` still finds `src/config.ts`.
- **Many findings on one line:** all cards under it in input order; the stripe takes the worst severity.
- **`kind` other than `finding`** (lethal trifecta): has a file and lines, treated like any finding.
- **`reviews.kind = 'summary'`:** no code path writes it today (`grep "'summary'" server/src` finds only types and the schema enum); D5 does not filter by kind.
- **Findings still loading:** no counters, no "review not run" note, no dots until `usePrReviews` resolves.

## Risks & rollback

- **R1 — Race with the detail refresh.** With a GitHub token, `GET /pulls/:id` deletes and re-inserts `pr_files` without a transaction (`server/src/modules/pulls/routes.ts:258-268`). A parallel smart-diff read can see no files or a partial set. Mitigation: `DiffTab` mounts only after the detail query resolved (`PrDetailContent.tsx:126-128`), the key is per `head_sha` (D8), and missing paths fall back to core. Worst case: some files sit in core until the head changes. Fixing it is a pulls-module change, out of scope.
- **R2 — Policy twin drift (D5).** No automated check (AR-3, accepted debt). The UI never reads `finding_lines`, so the screen stays self-consistent; only the route could disagree with it.
- **R3 — Classifier false positives**, e.g. `src/build/index.ts` → wiring (barrel), since `build/` is root-anchored. A wrong group only reorders files, never hides them. `ROLE_PATTERNS` is the one place to tune.
- **R4 — "Original order" is only as good as `pr.files` order.** With a token, `pr.files` is GitHub's own list (`pulls/routes.ts:294`). Offline, it is `select … from pr_files` with no `ORDER BY` (`pulls/routes.ts:298`), in practice insertion order. Unchanged here.
- **R5 — `DiffTab` grows.** Mitigation: sites 22-27 move logic into helpers and three sub-components.
- **R6 — Restyling the viewer** changes the look of existing rows (fs 13 → 12, del sign muted). Only `DiffTab` uses the viewer (D15); no test asserts styles. Checked in step 10.
- **Rollback.** Revert the client commits and the tab returns to today's flat list. The route, the enum extension and the reviewer-core exports are additive; an old client ignores them. No DB change.

## Untrusted inputs

- **PR file paths** (from GitHub, author-controlled) reach `classifyFile`'s regexes. Every pattern is anchored with no nested quantifiers or backreferences, so there is no ReDoS; T-1 bounds a 4 096-character path at 5 ms. Paths render only as JSX text.
- **Finding title, rationale, suggestion** (model output, possibly echoing PR text) render only through `FindingCard` (title as a text node, rationale and suggestion through `<Markdown safe>`, `FindingCard.tsx:89,95`) and as the stripe's `title` attribute, which React escapes. No `dangerouslySetInnerHTML`, no `href` from model data (AC-34).
- **The `:id` param** is validated by `IdParams`; the PR lookup is workspace-scoped (`pull.repo.ts:8-18`), so there is no IDOR (AC-11, T-3 other-workspace case).
- No PR, diff or user text reaches an LLM, a shell or raw SQL in this feature.

## Relevant INSIGHTS entries

- root `INSIGHTS.md`, Tool & Library Notes: `pnpm_config_verify_deps_before_run=false` skips the failing pnpm preflight.
- root `INSIGHTS.md`, Recurring Errors: `./scripts/e2e.sh` shares `client/.next` with a running dev server; stop the dev app before step 10.
- `reviewer-core/INSIGHTS.md`, Codebase Patterns: a pure function needed by reviewer-core and the server lives in reviewer-core, re-exported from `src/index.ts` (D1).
- `client/INSIGHTS.md`, What Works: a mock of `api.get` skips ADR 0007 validation; the fake parses through the schema (T-8).
- `client/INSIGHTS.md`, Tool & Library Notes: a missing namespace only logs `MISSING_MESSAGE`; steps 7 and 9 grep for it, and T-6 / T-8 assert visible label text.
- `client/INSIGHTS.md`, Tool & Library Notes: `@testing-library/user-event` is now a devDependency; new cases use `userEvent.setup()`.
- `client/INSIGHTS.md`, Recurring Errors: `<main>` is the only scroll container and must stay `position: relative`; the stripe is anchored to its row (`position: relative`), and the sticky header needs no overflow ancestor (D16).
- `client/INSIGHTS.md`, Recurring Errors: value imports of `@devdigest/shared` schemas work via `extensionAlias`; import the contract subpath (site 9).
- `client/INSIGHTS.md`, What Doesn't Work: a local `notify.error` doubles the global toast. The new mutation call adds no local toast; `DiffTab`'s comment path keeps its `LOCAL_ERROR` meta (`DiffTab.tsx:14`).
- `server/INSIGHTS.md`: `buildApp` does not run the boot reaper (ADR 0020), so T-3 cannot flip a live run.

## Open questions

- **OQ-1** `dist/**` and `build/**` are root-anchored as the brief wrote them, so `client/dist/app.js` is core (pinned in T-1). Should they match any segment? That would make `src/build/…` boilerplate. Non-blocking.
- **OQ-2** Copy: the tests / docs descriptions and the new state strings were written by the planner (Visual spec). The human can change them in the JSON alone. Non-blocking.
- **OQ-3** Summary counts come from the loaded `files` (D18), so on a partially seeded PR they differ from the header's `files_count`. Non-blocking; one line in `summarize`.
- **OQ-4** Resolved in round 2: the architecture reviewer accepted the domain-ring import of `@devdigest/reviewer-core` (D2). Known, not a violation: the barrel loads the whole package at runtime (including the `openai` SDK and zod), as `helpers.ts:10` already does; depcruise checks direct edges only. Subpath imports are untested in the server build, so not used.

## Review log

| Round | Reviewer | Finding | Severity | Resolution |
|---|---|---|---|---|
| 0 | planner self-review | Agent tool unavailable at that depth; independent review did not run | — | recorded; external round 1 followed |
| 0 | self (plan-critic) | Nested `reviews/smart-diff/*` escaped depcruise purity rules | MAJOR | superseded by NEW D1 / D2: classifier in reviewer-core, builder in flat `reviews/domain.ts` gated by `domain-is-pure`; depcruise change dropped |
| 0 | self (plan-critic) | Render prop `renderFinding` breaks Render Factories | MAJOR | fixed in D9 (component slot) |
| 0 | self (plan-critic) | "Latest review" ambiguous for multi-agent runs | MAJOR | D5, now human-approved |
| 0 | self (plan-critic) | Comments-hidden default would hide findings after a review | MAJOR | D7, now human-approved |
| 0 | self (plan-critic) | Findings for paths not in `pr.files` had no home | MINOR | AC-24, sites 23, 28 |
| 0 | self (plan-critic) | `patch: null` hid the unmatched block | MINOR | site 14 note, T-6 |
| 0 | self (architecture) | `ReviewService.smartDiff` has no port/fake | MINOR | rejected: read passthrough, logic in pure builder (onion `references/anti-patterns.md` depth table); D14 accepted debt |
| 0 | self (architecture) | i18n namespace for strings inside `diff-viewer` | MINOR | D13 |
| 1 | orchestrator | Classifier location | decision | NEW D1: `reviewer-core/src/smart-diff/`, exported from the entry; D2 builder flat in `reviews/domain.ts`; old step 4, AR-1, AR-2 dropped |
| 1 | human | e2e/README.md role; findings scope; dismissed; toggle default | decision | D4, D5, D6, D7 recorded as approved; removed from Open questions |
| 1 | plan-critic PC-1 | Render all five groups, empty ones muted | MAJOR | fixed in Goals 1, D8, D17.2, AC-12, AC-13, Visual spec "Empty group", T-7 (`isEmpty`), T-8 ("0 files", no `aria-expanded`) |
| 1 | plan-critic PC-2 | #482 files have no patch, so inline cards cannot show there | MAJOR | fixed in step 10 demo data (#482 for counters/blocks; #490 for inline card/stripe with run-review or a `psql` insert on `start_line 6`), Edge cases |
| 1 | plan-critic PC-3 | No visual table with exact prototype values | MAJOR | fixed: Visual spec section with values, token line citations, role colours with rationale, copy table; D15 lists the four exceptions with reasons; sites 12, 24-26, 29 |
| 1 | plan-critic PC-4 | Sticky group header collides with sticky PR header | MAJOR | fixed in D16 (measured `--pr-header-h`, zIndex 4, `--bg-primary`), AC-27, sites 19-21, step 10 manual check |
| 1 | plan-critic PC-5 | Card action must pass `prId` | MINOR | fixed in D9 (`mutate({ findingId, action, prId })`), AC-22, T-8 asserts the refetch |
| 1 | plan-critic PC-6 | Branch header; worktree caveats | MINOR | fixed in header (`feat/smart-diff` on `9c789c2`); dirty-tree caveats removed; step 1 baseline + explicit-path staging kept |
| 1 | architecture AR-3 | "drift shows up as a failing test" overclaims | LOW | fixed in D5 / R2: accepted debt, `blockers.ts`-style header, `superseded` flag noted as the future alternative |
| 1 | architecture (open question) | `usePrSmartDiff` not invalidated on head move | — | fixed in D8: key `["smart-diff", prId, headSha]` re-keys on head change; core fallback stated; no post-run invalidation because `finding_lines` is not consumed, with the rule for a future consumer |
| 1 | orchestrator | Stale citation `pulls/routes.ts:298` | — | re-checked: line 298 is still the offline `pr_files` select; R4 now also cites `:294` (the GitHub path returns GitHub's list) |
| 1 | orchestrator | Design file "Not in prototype" items | — | each resolved in D17 |
| 1 | planner | Round-0 D11 introduced a new `SEVERITY_RANK` though `@devdigest/ui` exports one | MINOR | fixed in D11 (reuse `tokens.ts:34-37`) |
| 1 | planner | Round-0 line citations drifted (`FindingCard.tsx:90,97` → `:89,95`; `DiffTab.tsx:42` → `:41`) | MINOR | fixed throughout |
| 2 | architecture AR2-1 | `isActiveFinding` re-export would reach past the diff-viewer barrel | MEDIUM | fixed: site 17 exports `isActiveFinding` / `findingsForFile` as values; site 23 imports from `@/components/diff-viewer`, re-export dropped |
| 2 | architecture AR2-2 | Row → plain-shape mapping planned in `service.ts` | LOW | fixed: D14 + site 7a mappers in `reviews/helpers.ts` |
| 2 | architecture AR2-3 | Client group order had no named source | LOW | fixed: site 23 iterates `SmartDiffRole.options`; T-7 asserts it; `ROLE_META` lookup only |
| 2 | architecture AR2-4 | `useStickyOffset.ts` placement | LOW | fixed: `PrDetailContent/hooks/useStickyOffset.ts` (app-shell precedent), D16 |
| 2 | architecture (open question) | Ref timing: header mounts after the skeleton early return | — | fixed in D16: callback refs |
| 2 | architecture (open question) | Barrel runtime graph | — | recorded in OQ-4 as known |
| 2 | plan-critic PC-7 | "Show all" is a no-op on a PR with findings and no comments | MAJOR | fixed in D7 (no-comment case = `true`; render condition counts dismissed findings), T-7, T-8 Flow 4, step 10 #482 expectation |
| 2 | plan-critic PC-8 | psql insert missed NOT NULL columns; Accept does not change the counter | MINOR | fixed in step 10: full INSERT; Dismiss checks the counter |
| 2 | plan-critic PC-9 | `Record<Severity, …>` ambiguous (ui `Severity` has INFO) | MINOR | fixed in D11: `FindingRecord["severity"]` |
| 2 | plan-critic PC-10 | `isActiveFinding` not in the barrel | MINOR | fixed with AR2-1 (site 17) |
| 2 | plan-critic PC-11 | Sticky placement inside `Disclosure` | MINOR | fixed in D16: `headerStyle` row div |
| 2 | plan-critic PC-12 | Flat → grouped remount flicker | MINOR | fixed at site 9 with same-PR placeholder data (refined by PC-13). The first load still renders flat then grouped once (AC-17); accepted, since data arrives before most users interact |
| 3 | plan-critic | ACCEPT, 0 CRITICAL / 0 MAJOR | — | — |
| 3 | plan-critic PC-13 | `keepPreviousData` carries grouping across PRs | MINOR | fixed at site 9: placeholder only when `queryKey[1] === prId` |
| 3 | plan-critic PC-14 | Callback refs must be stable | MINOR | fixed in D16: `useCallback([])` + `useRef` |
| 3 | plan-critic PC-15 | No named `pr_files` row type | MINOR | fixed: site 7b `PrFileRow` |
| 3 | architecture-reviewer | APPROVE, 0 CRITICAL / 0 HIGH; AR3-1 refuted by its skeptic | — | — |
| 3 | architecture (nit) | `PrDetailContent/hooks/` should have an `index.ts` | — | fixed at site 21 |
| 3 | architecture (nit) | `findings.ts` mixes a React type with pure functions | LOW | fixed at site 11: header states the type-only React import |
| 3 | architecture (open question) | Move `isActiveFinding` / `findingsForFile` to `client/src/lib/findings.ts` | — | declined: the promotion rule moves code up on a second real consumer outside the viewer's tier; DiffTab imports through the viewer barrel, which the reviewer confirmed is allowed (`frontend-architecture/references/structure.md:93`) |
