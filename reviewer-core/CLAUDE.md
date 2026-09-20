# reviewer-core — the review engine

`diff → prompt → LLM → grounded findings`. Consumed as TypeScript **source** by
the server via a tsconfig path alias.

## Rules

- **Zero I/O.** No database, GitHub, filesystem, or network. The only side effect
  is the injected `LLMProvider`. That constraint is what makes the engine
  mock-testable — do not relax it to "just this once".
- Inputs arrive **resolved**. Callers turn skill slugs into bodies and memory ids
  into strings; the engine never looks anything up.
- All untrusted content (diff, PR body, repo map, callers, specs) passes through
  `wrapUntrusted()`. `assemblePrompt()` appends `INJECTION_GUARD` to every system
  prompt. Do not defend against injection by keyword-scanning untrusted text — a
  denylist only ever catches one phrasing, in one language.
- Grounding is mandatory. A finding that does not cite a real diff line is
  dropped by `groundFindings()`. The score is recomputed from the survivors; the
  model's self-reported score is ignored.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`, `repoMap`) are
  omitted when empty. Adding a slot must keep an absent slot a no-op.
- The package emits no JS. `pnpm typecheck` **is** the build.

## Gotchas

- Changing section order in `assemblePrompt` changes every review's output.
  Treat it as a behavioural change, not a refactor.
- `server/src/platform/{prompt,grounding,structured}.ts` are re-export shims over
  this package. Edit here.

## Read when

- Read `README.md` for the pipeline diagram and the public API surface.
- Read `docs/prompt-contract.md` before changing prompt assembly or grounding.
- Read `INSIGHTS.md` before starting work here and note which entries are
  relevant — treat it as high-confidence guidance unless this file says
  otherwise.

## Before you finish

Update `INSIGHTS.md` with anything durable you learned this session — don't
skip this step.
