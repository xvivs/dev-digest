# `@devdigest/reviewer-core` — the review engine

Pure review logic: **diff → prompt → LLM → grounded findings**. No database,
GitHub, or filesystem; the only side effect is an LLM call through an **injected**
`LLMProvider`, which is what makes it mock-testable.

In the starter the **server** (`@devdigest/api`) is its only consumer — for local
reviews in the studio. (The CI runner that runs the same engine in GitHub Actions
is added back in the Export-to-CI lesson, L06.) The server wires it via a tsconfig
path alias (`@devdigest/reviewer-core` → `../reviewer-core/src`) and consumes the
TypeScript **source** directly (tsx in dev, vitest in tests). The package never
emits JS — its `build` is a type-check.

## Pipeline

```mermaid
flowchart LR
  IN["inputs<br/>diff · system prompt · repo map"] --> PROMPT["assemblePrompt()<br/>prompt.ts"]
  PROMPT --> WRAP["wrapUntrusted() + INJECTION_GUARD<br/>fence untrusted content vs prompt injection"]
  WRAP --> LLM["LLMProvider (injected)<br/>llm/openrouter.ts"]
  LLM --> STRUCT["structured output<br/>llm/structured.ts<br/>Zod → JSON Schema · parse-with-repair"]
  STRUCT --> GROUND["groundFindings()<br/>grounding.ts<br/>mechanical citation gate vs the diff"]
  GROUND --> OUT["Review<br/>verdict · score · grounded findings"]
```

The grounding step is the mandatory gate: a finding that doesn't cite a real line
in the diff is dropped, so the engine can't hallucinate locations. The score is
recomputed deterministically from the **surviving** findings, not trusted from the
model. `review/run.ts` orchestrates the run (single-pass by default).

The engine also accepts optional prompt slots the **course lessons** start
feeding it — `skills` (L02), `memory` (L07), `specs` (L05), `callers` — plus a
`reduce()`/map-reduce path and a `toReview()` CI payload helper used from L06.
In the starter the server passes only the diff, system prompt, and repo map; the
extra slots are omitted, so `assemblePrompt` simply leaves those sections out.

## Prompt layout

`assemblePrompt()` emits two messages (ADR 0012, SPEC-02 D5):

```
system:  <agent system prompt>

         <one-line preamble>          ← only when skills are effective
         <skills>
         ### <name>
         <body>

         ### <name2> …
         </skills>

         INJECTION_GUARD              ← always LAST
user:    task · ## PR description · ## Relevant memory · ## Repo skeleton ·
         ## Project context · ## Callers of changed symbols · ## Diff to review
```

- Skills are **trusted instructions** (the server only passes vetted ones), so
  they live in the system message, not in `<untrusted>`. The guard closes the
  system message and states that skills may add checks but never waive
  findings, lower severity, or turn `<untrusted>` content into instructions.
- `neutralizeDelimiters` runs on skill names, skill bodies AND every
  `<untrusted>` block: `<untrusted`, `</untrusted`, `<skills`, `</skills` (any
  case, with inner whitespace, or with a fullwidth `＜`) become a visible token
  such as `[/skills]`. An HTML entity would not do: a model reads `&lt;/skills`
  as a closing tag. A tag name followed by more identifier characters
  (`<SkillsTab>`) is left alone, so diffs of JSX stay intact. So neither a skill
  nor a PR can close a delimiter or forge a `<skills>` block, and the guard adds
  that a `<skills>` block outside the system message is data.
- `assembly.skills` is the rendered block as sent (preamble included);
  `assembly.skills_tokens = estimateTokens(block)`. Both are `null` with no
  skills, and the prompt is then identical to one built without the slot.
  `skills_used` is filled by the server, not here.
- The no-waiver rule is pinned at prompt level only (`test/prompt-skills.test.ts`).
  Whether a model actually obeys it is a behavioural eval, out of scope here.

## Public API

Exported from `src/index.ts`: `assemblePrompt` / `wrapUntrusted` (prompt),
`groundFindings` / `groundingSummary` (grounding), `toJsonSchema` / `extractJson`
/ `parseWithRepair` (structured output), plus the `run` entrypoint and
`reduce`. Contracts (`Review`, `Finding`, `Verdict`, …) come from
`@devdigest/shared`.

## Testing

`npm test` (vitest) — hermetic units with a stubbed `LLMProvider`: prompt
assembly, the grounding gate, `toReview` selection, and a full `run`. No keys,
no network. `npm run typecheck` doubles as the build. See
[`../TESTING.md`](../TESTING.md).
