# e2e — browser suite

Deterministic UI flows driven by Vercel **agent-browser** (CDP). No Playwright,
no LLM, no API key.

## Rules

- A flow is `specs/NN-name.flow.json`: a list of agent-browser commands run in
  order by `run.ts`. Each `cmd` is passed verbatim; a non-zero exit fails the flow.
- `wait --text` / `wait --url` **are** the assertions. There is no assertion DSL.
- Deterministic locators only (`--url`, `--text`, `find role|text|label`, plain
  CSS for `get count`/`hover`/`focus`/`scrollintoview`). Never use the AI `chat`
  command — it would make runs non-reproducible and need a key.
- A flow that targets a specific repo **must** open with the guard
  `wait --text "acme/payments-api"` right after `wait --url /pulls`, and must
  reach a PR by clicking its **title**, never by row position.

## Gotchas

- **Run `./scripts/e2e.sh`**, not `pnpm test`. The seed holds **two** repos
  (`acme/payments-api` and `xvivs/dev-digest`) and `listByWorkspace` has no
  `ORDER BY`, so the repo `/` redirects to is not guaranteed — hence the guard
  step above. The hermetic runner boots an isolated, freshly-seeded stack on
  alternate ports; your dev DB may also be *stale* (the seed only inserts the
  demo repo when missing, so widened fixtures never reach an old database and
  re-seeding won't fix it), which fails count assertions against healthy code.
- **`find … click` silently no-ops below the fold** — prints `✓ Done`, exits 0,
  click never lands. `scrollintoview` first, then back the click with a
  `get count` assertion that can only hold if it landed.
- **`wait --text` is case-sensitive, `find text` is not.** Assert the case the
  browser paints; disambiguate buttons with `find role … --name X --exact`.
- Never `docker compose down -v` to "reset" — it deletes every imported repo.

## Read when

- Read `README.md` for the flow format, env knobs and the coverage table.
- Read `INSIGHTS.md` before starting work here and note which entries are
  relevant — treat it as high-confidence guidance unless this file says
  otherwise.

## Before you finish

File anything durable you learned this session into `INSIGHTS.md` **through
the `engineering-insights` skill** — don't skip this step, and don't edit the
file by hand. Hand-written entries land undated, unreferenced and in the wrong
section, and nothing catches it until someone audits the file months later.
