# INSIGHTS — reviewer-core

Append-only journal of things that cost us time in the review engine. Write
here **first** and without a filter: an entry is cheap, a line in `CLAUDE.md`
is not.

This package is where prompt and grounding behaviour lives, so entries about
*model output quality* belong here — not only crashes.

Findings that cross package boundaries go in the repo-root `../INSIGHTS.md`.

Priority: prompt and model-output quality issues, not just crashes — including
a prompt change that moved results in an unexpected direction.

Append-only: add entries under the matching section below; never edit or
delete an existing entry once written (the one exception — monthly cleanup —
lives in the engineering-insights skill).

## What Works

## What Doesn't Work

- **A delimiter-neutralizing regex without a trailing boundary mangles real code: `/<\/?(untrusted|skills)/i` also rewrites `<SkillsTab>` / `<untrustedness` inside a reviewed diff** — the diff is shown to the model verbatim, so rewriting identifiers corrupts the code under review for any PR touching JSX named like a delimiter. `neutralizeDelimiters` (`reviewer-core/src/prompt.ts:49`) needs the lookahead `(?=[\s>/]|$)`. An HTML-entity replacement (`&lt;/skills`) also fails: models read it as the closing tag, so the token is rewritten to a visibly different `[/skills]`. _(2026-09-28)_

## Codebase Patterns

- **A pure function needed by BOTH `reviewer-core` and server-only adapters belongs in `reviewer-core`, re-exported from `src/index.ts`** — never in a server-only file like `server/src/adapters/llm/pricing.ts` — because the dependency direction is one-way (server → reviewer-core via the `@devdigest/reviewer-core` tsconfig path alias; reviewer-core → `@devdigest/shared` only for types, never → server). Example: `pickCost` (cost-provenance tagging) lives in `reviewer-core/src/llm/cost.ts`; `llm/openrouter.ts` imports it directly, `server/src/adapters/llm/{openai,anthropic}.ts` import it via `@devdigest/reviewer-core`. _(2026-09-19)_

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

### 2026-09-19 — Cost Badge (reviewer-core) session
Added `costSource` to `ReviewOutcome` and a map-reduce cost-provenance fold in `review/run.ts` ("weakest claim wins": provider+provider→provider, any estimated in the mix→estimated, any chunk missing a cost→both `costUsd`/`costSource` null), plus the shared `pickCost` helper in the new `llm/cost.ts`, used by both `OpenRouterProvider` and the server's OpenAI/Anthropic adapters. All tests pass (`run.test.ts` grew from 4 to 7 cases).

### 2026-09-28 — reviewer-core session
Renamed `reviewer-core/CLAUDE.md` to `AGENTS.md` and added a one-line `@AGENTS.md` stub `CLAUDE.md` next to it, per ADR 0004. Edit rules in `AGENTS.md` only; the content itself did not change.

### 2026-09-28 — reviewer-core session (SPEC-02 Skills)
Skills moved into the system message before `INJECTION_GUARD`, which gained a no-waiver rule and a statement that `<skills>` outside the system message is data. One `neutralizeDelimiters` now covers skill text and every untrusted block, since the old `wrapUntrusted` let case variants of `</untrusted>` through. 44 tests green; the behavioural (LLM) waiver eval is still open.

## Open Questions
