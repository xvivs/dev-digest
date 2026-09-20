# e2e — browser suite

Deterministic UI flows driven by Vercel **agent-browser** (CDP). No Playwright,
no LLM, no API key.

## Rules

- A flow is `specs/NN-name.flow.json`: a list of agent-browser commands run in
  order by `run.ts`. Each `cmd` is passed verbatim; a non-zero exit fails the flow.
- `wait --text` / `wait --url` **are** the assertions. There is no assertion DSL.
- Deterministic locators only (`--url`, `--text`, `find role|text|label`). Never
  use the AI `chat` command — it would make runs non-reproducible and need a key.

## Gotchas

- **Run `./scripts/e2e.sh`**, not `pnpm test`. Flows 02/04/05 follow the home
  redirect to the *first* repo and assume the seeded demo repo is the only one.
  The hermetic runner boots an isolated freshly-seeded stack on alternate ports;
  running against your dev DB lands on the wrong repo and fails.
- Never `docker compose down -v` to "reset" — it deletes every imported repo.

## Read when

- Read `README.md` for the flow format, env knobs and the coverage table.
- Read `INSIGHTS.md` before starting work here and note which entries are
  relevant — treat it as high-confidence guidance unless this file says
  otherwise.

## Before you finish

Update `INSIGHTS.md` with anything durable you learned this session — don't
skip this step.
