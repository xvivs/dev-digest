# DevDigest client — test-quality & security audit

Repo: `/Users/vladyslav.semenov/emdash/worktrees/dev-digest-633612e0/emdash-lesson-02-apez1`
Scope: `client/` only, read-only. Rules sources: `.claude/skills/react-testing-library/{SKILL.md,README.md}`, `.claude/skills/security/SKILL.md`. Context: `TESTING.md`, `client/AGENTS.md`, `client/INSIGHTS.md`, `client/vitest.config.ts`, `client/package.json`.

---

## 1. Vitest run result

Command: `cd client && ./node_modules/.bin/vitest run` (pnpm preflight bypassed per client/INSIGHTS.md — confirmed necessary; `pnpm test` would fail on `[ERR_PNPM_IGNORED_BUILDS]`).

```
Test Files  19 passed (19)
     Tests  102 passed (102)
  Duration  3.68s
```

All green, zero failures, zero skipped. Two `stderr` warnings, both from `src/test/smoke.test.tsx` (component-gallery smoke test), both from Recharts, not from RTL/React:
```
The width(0) and height(0) of chart should be greater than 0, please check the style of container...
```
This is a known jsdom-has-no-layout artifact (ResponsiveContainer measures 0×0 under jsdom) — harmless, not an `act()` warning. No `act()` warnings anywhere in the run. Grepped for suppression patterns (`console.error =`, `vi.spyOn(console...)`) across all `*.test.ts*` — zero matches, so warnings are not being hidden.

---

## 2. Coverage map

`has behaviour` = state, branching, formatting/parsing logic, or non-trivial event wiring (not pure prop→JSX passthrough). `gap priority` = HIGH (real logic, zero test, zero indirect coverage) / MEDIUM (some test but thin, or indirect coverage only) / LOW (adequately covered or no real behaviour to test).

### `client/src/app/**/_components/*`

| Component | Has test | Has behaviour | Gap |
|---|---|---|---|
| `agents/[id]/_components/AgentEditor` | Yes (1 test, smoke) | Yes — form, tabs | **MEDIUM** — only static-render assertion, no field edit/save/error flow |
| `AgentEditor/_components/ConfigTab` (146 lines) | No | Yes — model picker, fields | **HIGH** |
| `agents/_components/AgentCard` | Yes (2 tests) | Small (fallback text) | LOW |
| `agents/_components/AgentsListView` | No | Yes — list render | MEDIUM |
| `AgentsListView/_components/CreateAgentModal` | No | Yes — form, submit, `router.push` on create | **HIGH** |
| `onboarding/_components/AddRepoView` | No | Yes — form validation, submit, redirects (3 `router.push` sites) | **HIGH** |
| `pulls/[number]/_components/DiffTab` | No | Yes — composes diff + comments | MEDIUM-HIGH |
| `.../FindingCard` | Yes (3 tests) | Yes | LOW |
| `.../FindingsPanel` | Yes (8 tests, deep) | Yes | LOW |
| `.../FindingsTab` | No | Yes — `run_id`→review join maps (the exact class of bug INSIGHTS.md's "PR timeline row … is a `run_id` join miss" entry describes) | **HIGH** |
| `.../OverviewTab` | No | Low-moderate | LOW-MEDIUM |
| `.../PrDetailHeader` | No | Moderate | MEDIUM |
| `.../ReviewRunAccordion` | Yes (6 tests, deep) | Yes | LOW |
| `.../RunHistory` (+ `_components/RowAction`) | Yes (16 tests, very deep) | Yes | LOW |
| `.../RunReviewDropdown` | Yes (**1 test**: trigger label only) | Yes — menu open, agent list, empty-agents redirect, `mutateAsync` run | **MEDIUM-HIGH** |
| `.../RunStatus` | Yes (**1 test**: empty-runIds only) | Yes — live SSE status, this is the component's whole purpose | **MEDIUM-HIGH** |
| `.../RunTraceDrawer` | Yes (3 tests) | Yes | LOW-MEDIUM |
| `RunTraceDrawer/_components/{FindingsSection,PromptBlock,PromptModalBody,TraceBody,TraceSection}` | No dedicated test (partial indirect via RunTraceDrawer.test.tsx) | Moderate | MEDIUM |
| `RunTraceDrawer/_components/ToolCallRow` | No | Yes — INSIGHTS.md itself flags this as "unreachable from the browser … rests on unit tests only," but no unit test exists either | **HIGH** |
| `.../SeverityFilterBar` | No | Yes — disabled-state logic | MEDIUM |
| `.../VerdictBanner` | Yes (**1 test**, only `request_changes` branch) | Yes — `VERDICT_META[verdict]` 3-way branch, conditional blockers/agentName/score | **MEDIUM** |
| `pulls/_components/FilterBar` | No | Yes — filtering | MEDIUM |
| `pulls/_components/PRRow` | Yes (6 tests, deep) | Yes | LOW |
| `pulls/_components/PrFindingsCell` | Yes (4 tests, deep) | Yes | LOW |
| `settings/[section]/_components/SettingsView` | No | Small — tab routing | LOW-MEDIUM |
| `SettingsView/_components/SectionTitle` | No | None (presentational) | LOW |
| `SettingsView/_components/SettingsApiKeys` | No | Yes — reveal toggle, test-connection call, status badge, **secret-adjacent UI** | **HIGH** |
| `SettingsView/_components/SettingsModels` | No | Yes — model save | MEDIUM-HIGH |

### `client/src/components/*`

| Component | Has test | Has behaviour | Gap |
|---|---|---|---|
| `app-shell` (`AppShell.tsx` + `hooks/{useShellContext,useShellCommands,useGlobalShortcuts}`) | **No test anywhere** | Yes — `g`-then-key nav state machine, Cmd/K palette, command palette resolution | **HIGH** |
| `diff-viewer` (`helpers.ts::parsePatch`, `comments.ts::{buildThreads,partitionThreads,keysForLine,commentTargetFor}`, `CommentCard`) | No test anywhere | Yes — unified-diff parsing, thread grouping/matching, all pure & branchy | **HIGH** |
| `findings-popover` | Yes (component 15 + helpers 8) | Yes | LOW |
| `mermaid-diagram` | No | Yes — `looksLikeMermaid` regex gate, pending/ok/invalid state, lazy import | MEDIUM |
| `page-shell` | No | None | LOW |
| `repo-not-found` | No | Trivial | LOW |
| `run-cost-value` | Yes (component 5 + helpers 6, thorough) | Yes | LOW |
| `severity-icons` | Yes (component 6 + helpers 8, thorough) | Yes | LOW |
| `showcase` | Indirect (via `smoke.test.tsx`) | N/A (dev gallery, intentional per AGENTS.md) | LOW |

### `client/src/lib/hooks/*`

| File | Has test | Has behaviour | Gap |
|---|---|---|---|
| `agents.ts` | No dedicated test; mocked/exercised via several component tests | Thin CRUD wrappers | LOW-MEDIUM |
| `core.ts` | No dedicated test; some indirect | Thin CRUD wrappers | LOW |
| `repo-intel.ts` | No test, no indirect coverage found | Unknown/thin | MEDIUM |
| `reviews.ts` | No dedicated test. `useRunEvents` (SSE subscribe: JSON parse, multi-source open/error counting, `notify.error` on `kind==="error"`, cleanup) is **mocked away in every consuming test** — never actually exercised | Yes, real branching | **HIGH** |
| `trace.ts` | No test; mocked away in `RunTraceDrawer.test.tsx` | Thin | MEDIUM |

### `client/src/lib/*.ts`

| File | Has test | Has behaviour | Gap |
|---|---|---|---|
| `api.ts` (`apiFetch`) | **No test, no indirect coverage** — every test stubs `global.fetch` directly, bypassing `apiFetch`'s own branching | Yes — network-failure branch, non-ok + JSON/non-JSON error body branch, empty-body content-type conditional, 204 branch. This is the single most-depended-on file in the package | **HIGH** |
| `feature-models.ts` | No | None (static data) | N/A |
| `github-urls.ts` (`githubPrUrl`, `githubBlobUrl`, `encPath`) | No | Yes — path-segment encoding, single-line vs line-range URL branch | **MEDIUM-HIGH** |
| `model-label.ts` (`modelLabel`, `toModelOptions`, `fmt`, `ctx`) | No | Yes — price/context formatting branches | **MEDIUM-HIGH** |
| `types.ts` | No | None (types only) | N/A |
| `theme.tsx`, `repo-context.tsx` (not in the requested glob but adjacent) | No | Yes — `repo-context.tsx`'s "URL path > localStorage > first repo" priority fallback | MEDIUM |
| `pulls/helpers.ts` (`sizeOf`, `relativeTime`) | No | Yes — S/M/L thresholds, now/m/h/d time-unit boundaries | **MEDIUM-HIGH** |

---

## 3. Test-quality findings

| ID | Severity | File:line | Evidence | Fix | Effort | Confidence |
|---|---|---|---|---|---|---|
| TEST-1 | LOW | `RunHistory.test.tsx:272,275,278,290,294` | `expect(row.style.background).toBe("var(--bg-elevated)")`, `expect(deleteBtn.style.color).toBe("var(--crit)")` | Architecture-driven: the codebase styles via inline `CSSProperties` objects, not CSS classes, so there is no non-implementation-detail way to assert hover colour short of this. SKILL.md's "Skip: CSS classes or inline styles" doesn't have a clean alternative here. No fix required; flagged for completeness only. | — | MEDIUM |
| TEST-2 | LOW | `RunHistory.test.tsx:217,270`; `SeverityIcons.test.tsx:52,64,74`; `FindingsPopover.test.tsx:236` | `container.querySelector('[data-run-id="run-1"]')`, `container.querySelectorAll("[data-severity]")` | SKILL.md Anti-Patterns table flags `container.querySelector()` outright. In every instance found here the selector targets a `data-*` attribute the codebase documents as a stable, load-bearing contract (INSIGHTS.md: "`data-severity`... is load-bearing, not a shortcut"), not an accidental structural leak — defensible, but a `getByTestId`-style custom query pointed at these attributes would satisfy the skill's letter too. | S | MEDIUM |
| TEST-3 | MEDIUM | 16 test files, e.g. `AgentCard.test.tsx:26-35`, `PRRow.test.tsx:116-134`, `FindingsPanel.test.tsx:52-58`, `RunHistory.test.tsx:66-84` | Every file hand-rolls its own `renderWithIntl`/`renderRuns`/`renderRow`/`renderCell` wrapping `NextIntlClientProvider` (3 files additionally wrap `QueryClientProvider`) — `client/src/test/` contains only `setup.ts` and `smoke.test.tsx`, no shared render helper | Extract a `src/test/render.tsx` with `renderWithProviders(ui, {messages, queryClient})`; each call site still supplies its own namespace map (that part is correctly per-tree, per INSIGHTS.md) but the boilerplate wrapper itself is 100% duplicated logic | S (1-2h) | HIGH |
| TEST-4 | MEDIUM | `FindingCard.test.tsx:55,57`; `RunTraceDrawer.test.tsx:68` | `fireEvent.click(screen.getByText("Accept"))`, `fireEvent.click(screen.getByText("log"))` locate buttons/tabs by text instead of `getByRole('button'/'tab', {name:...})` | Swap to `getByRole` — SKILL.md Tier-1 priority ("always try first") | S | HIGH |
| TEST-5 | MEDIUM | `VerdictBanner.test.tsx` (1 test), `RunStatus.test.tsx` (1 test), `RunReviewDropdown.test.tsx` (1 test) | See Coverage map — each exercises one branch/state of a component with real conditional logic (`VerdictBanner.tsx:28` `VERDICT_META[verdict]`; `RunStatus`'s only assertion is the empty-array early-return; `RunReviewDropdown`'s menu/empty-state/run-review mutation are mocked and ready to assert on but never invoked) | Add 1-2 more flow tests per component per SKILL.md's own Scenario Matrix ("Conditional rendering: different props → different output") | S-M each | HIGH |
| TEST-6 | INFO | All interaction tests | `fireEvent` used everywhere; SKILL.md mandates `userEvent` ("NEVER fireEvent") | **Not actionable** — `client/INSIGHTS.md` documents `@testing-library/user-event` is not a dependency in this project and that `fireEvent.mouseEnter` doesn't reach React 19 delegated handlers, making `fireEvent.mouseOver`/`mouseOut` the correct substitute. Flagged only so a future reviewer doesn't misapply the generic skill rule against a documented, deliberate deviation. | — | HIGH |

---

## 4. Security findings

Stack note: `.claude/skills/security/SKILL.md` is written for React+Express+Mongo+JWT; this app is Next 15 App Router client + Fastify API (server out of scope) with **no auth** (`LocalNoAuthProvider`, per root `AGENTS.md`). A01/A04/A07/JWT/Mongo sections don't apply to the client. Applied: A02 (env exposure), A05 (XSS via markdown/mermaid/raw HTML), secret handling, link safety.

| ID | Severity | File:line | Evidence | Attack scenario | Fix | Effort | Confidence |
|---|---|---|---|---|---|---|---|
| SEC-1 | LOW | `CommentCard.tsx:25` | `<a href={c.html_url} target="_blank" rel="noopener noreferrer">` — `rel` is correctly present (tabnabbing-safe), but `c.html_url` (a `PrReviewComment` field proxied from GitHub's API by the out-of-scope server adapter) is used as `href` with no client-side protocol allowlist | If the server-side GitHub proxy ever forwarded a forged/malicious `html_url` (not normally attacker-reachable — GitHub itself generates this field, not the PR author), a `javascript:` URI would execute on click | Defense-in-depth: validate `c.html_url` starts with `https://github.com/` before rendering, matching the OWASP "validate URL before href" rule | S | LOW — per the skill's own confidence table this is exactly a "LOW: theoretical / best-practice deviation → do not report" case; included for completeness only, input source (GitHub-generated, not user-typed) makes it non-exploitable in the normal flow |

**No MEDIUM/HIGH/CRITICAL findings.** Specifically checked and clean:

- **`dangerouslySetInnerHTML`** — exactly one use, `layout.tsx:21`, injecting `themeNoFlashScript` (`lib/theme.tsx:44`) — a **compile-time static string literal**, no interpolation of any request/user/API value. Standard, safe Next.js anti-FOUC pattern. Not reportable (skill: "Do NOT flag ... server-controlled values").
- **`react-markdown` usage** (`vendor/ui/primitives/Markdown.tsx`) — used for all untrusted content rendering: `CommentCard.tsx:31` (GitHub PR comment bodies), `FindingCard.tsx:97,103` (LLM-generated `rationale`/`suggestion`). No `rehype-raw` anywhere in the repo (grepped, zero matches) — raw HTML embedded in markdown source is rendered as inert text, not DOM, by `react-markdown`'s default behaviour. No `urlTransform` override — the library's built-in default transform (protocol allowlist: http/https/mailto/etc., strips `javascript:`) applies unmodified. Custom `a` renderer (`Markdown.tsx:31-35`) passes `href` straight through post-sanitization — no double-escaping bug.
- **`mermaid`** — `MermaidDiagram.tsx:38`: `mermaid.initialize({ securityLevel: "strict" })`, the safe setting (disallows script/HTML in labels), plus a pre-render `mermaid.parse(..., {suppressErrors:true})` validation gate and a keyword-prefix regex (`MERMAID_RE`) rejecting non-diagram input before ever calling `mermaid.render`. Well-defended.
- **Settings API keys screen** (`SettingsApiKeys.tsx`) — key value lives only in local component state (`val`), sent once via `test.mutateAsync({provider, key: val.trim()})` (POST body) to `/settings/test-connection`; `useSecretsStatus` (`core.ts:58-64`) returns **booleans only**, comment at line 57 says so explicitly (`/** ... booleans only — never the values). */`). No `localStorage`/`sessionStorage` write of any key value (grepped both — zero matches for either storage API anywhere in `src`, at all, for anything).
- **`console.log`/`warn`/`error`/`debug``** — grepped the entire `src` tree: **zero matches**. No risk of a key/token/PII landing in browser console logs from the client.
- **`process.env`** — exactly one usage, `api.ts:6`, `NEXT_PUBLIC_API_BASE` (correctly `NEXT_PUBLIC_`-prefixed, i.e. intentionally public per Next.js convention, and it's an API base URL, not a secret).
- **`apiFetch`** (`api.ts`) — no `credentials: 'include'` anywhere (grepped, zero matches for `credentials`), consistent with the local, no-auth, same-origin-by-convenience dev tool this is; no CSRF/cookie-leak surface to flag.
- **Open redirects** — every `router.push`/`router.replace` call site (24 found via grep) builds its target from local route params/component state (`repoId`, `pr.number`, static literals like `"/onboarding"`), never from a raw `useSearchParams()` value re-injected into a destination path. No open-redirect pattern found.
- **`target="_blank"`** — both occurrences (`CommentCard.tsx:25`, `vendor/ui/primitives/MonoLink.tsx:30`) correctly pair it with `rel="noopener noreferrer"`.

---

## 5. What's good (≤5)

1. Deep, real-user-flow test suites for the highest-risk interactive surfaces (`RunHistory` 16 tests, `FindingsPopover` 15, `FindingsPanel` 8, `PRRow`/`PrFindingsCell` — all combine render→interact→assert into single flow tests per the skill's own philosophy, with fake timers correctly used for the popover's open/close delay state machine).
2. `react-markdown` is used consistently (no `dangerouslySetInnerHTML` competitor) for every surface that renders GitHub/LLM-authored content, with no `rehype-raw` anywhere — the one architectural decision that closes off the biggest XSS vector in a PR-review tool almost entirely.
3. Secret handling in `SettingsApiKeys` is correct by construction: key values never leave a POST body, `useSecretsStatus` is explicitly typed/commented "booleans only — never the values," and there is zero `console.*` or storage-API usage anywhere in the client to leak them through.
4. `INSIGHTS.md` genuinely documents and justifies every "anti-pattern" this audit would otherwise flag (`fireEvent` over `userEvent`, `data-*` attribute queries, no shared render helper's namespace-per-tree requirement) — the deviations are load-bearing decisions, not oversights.
5. `mermaid.initialize({securityLevel: "strict"})` plus a pre-validation gate (`mermaid.parse` + a diagram-keyword regex) before ever handing untrusted text to `mermaid.render` is a well-thought-out defense that goes beyond the library's defaults.

---

## 6. Coverage of this audit (no silent caps)

- **Read in full**: all 19 test files were either fully read or (for `helpers.test.ts` ×3, `smoke.test.tsx`) sampled; all cited source files were read directly, not summarized from search snippets.
- **Not read in full / lower confidence**: `AgentsListView.tsx`, `SettingsModels.tsx`, `FilterBar`, `OverviewTab`, `PrDetailHeader`, `SeverityFilterBar`, `DiffTab`, `ConfigTab.tsx`, `CreateAgentModal.tsx`, `AddRepoView.tsx` — their "has behaviour" / gap classification in the coverage map is based on line count, imports, and adjacent-component context (helpers/constants files, router calls), not a full read of each file's JSX. If a precise line-by-line audit of any of these is wanted, flag it for a follow-up pass.
- **Server, `reviewer-core`, `e2e`**: explicitly out of scope per the task; not touched. Any exploitability judgment that depends on server-side validation (SEC-1) is marked LOW/unconfirmed for exactly this reason, not glossed over.
- **`process.env` / `.env` files themselves**: not read (none referenced by the client beyond `NEXT_PUBLIC_API_BASE`); did not go looking for `.env*` files on disk since the task scope is client source, not repo config.
- App was not run; no browser verification. Per the task's own prohibitions, only `vitest run` was executed, unmodified.
