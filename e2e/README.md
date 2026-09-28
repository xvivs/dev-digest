# `@devdigest/e2e` — browser end-to-end suite

Deterministic UI flows for the web app, driven by
[Vercel **agent-browser**](https://github.com/vercel-labs/agent-browser) — a
native (Rust + CDP) browser-automation CLI. **No Playwright, no LLM, no API key.**

agent-browser is a CLI, not a test framework, so this package adds a thin
convention: each flow is a JSON list of agent-browser commands, run in order
against one shared browser session by `run.ts`.

## How a flow works

A spec lives in `specs/NN-name.flow.json`:

```jsonc
{
  "name": "App boots and lands on the seeded repo's PR list",
  "steps": [
    { "cmd": ["open", "{BASE}/"],            "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"],    "label": "root redirects to PRs" },
    { "cmd": ["wait", "--text", "#482"],     "label": "seeded PR row visible" }
  ]
}
```

- `{BASE}` is replaced with `E2E_BASE_URL` (default `http://localhost:3000`).
- Each `cmd` is passed verbatim to `agent-browser`. A non-zero exit fails the
  step and the flow — so `wait --text` / `wait --url` **are** the assertions
  (they time out and exit non-zero if the condition never holds).
- Optional `"assert": { "stdoutIncludes": "…" }` adds a substring check on the
  command's stdout.
- Locators are deterministic only (`--url`, `--text`, `find role|text|label`,
  and plain CSS for `get count` / `hover` / `focus` / `scrollintoview`).
  We never use the AI `chat` command, so runs are stable and key-free.

### Locator gotchas (all three cost us a green-but-meaningless suite)

- **`find … click` silently no-ops on an element below the fold.** It prints
  `✓ Done` and exits 0 while the click never lands, so the steps after it keep
  asserting the pre-click state and the flow passes without testing anything.
  Always `scrollintoview` the target first, and pair a click with a
  `get count` assertion that can only hold if the click really landed.
- **`wait --text` is case-SENSITIVE; `find text` is case-INSENSITIVE.** Write
  `wait --text` in the case the browser *paints* (CSS `text-transform` counts).
  Because `find text` ignores case, `find text "Warning"` cannot tell the tally
  pill (`2 WARNING`), the timeline chip (`2 Warning findings`) and the filter
  button (`Warning`) apart — address the filter as
  `find role button --name Warning --exact` instead.
- **`get attr` with a multi-match selector returns the first match** (exit 0);
  it only fails when nothing matches. `get count` prints a bare number, so
  `"assert": { "stdoutIncludes": "2" }` is the way to assert a count — keep the
  expected values single-digit, since the check is a substring match.

Flows target **read-only seeded data** (the demo repo `acme/payments-api`, PR
#482, the seeded agents), so nothing triggers a model call.

> **Precondition: a freshly-seeded DB.** The seed creates **two** repos —
> `acme/payments-api`, which every flow here targets, and `xvivs/dev-digest` —
> and `ReposRepository.listByWorkspace` has no `ORDER BY`, so which of them `/`
> redirects to is **not guaranteed by contract**. This is the seed's permanent
> shape, not a regression. Every flow that depends on a specific repo therefore
> opens with a guard step — `wait --text "acme/payments-api"` immediately after
> `wait --url /pulls` — so that a redirect to the other repo fails the flow
> there, loudly, instead of quietly asserting against the wrong data. Treat the
> guard as a permanent part of the preamble, not a workaround awaiting a server
> fix. For the same reason, flows reach a PR by clicking its **title** rather
> than a row position.
>
> Staleness is the other half of the precondition. The seed inserts the demo
> repo only when it is missing, so a database seeded before a fixture was
> widened keeps the old rows forever and re-running `pnpm db:seed` will not
> repair it — count assertions then fail against perfectly healthy code.
> **Use the hermetic runner below** — it spins up its own isolated,
> freshly-seeded stack and leaves your dev DB untouched.
>
> ⚠️ **Never `docker compose down -v` to "reset" your dev DB** — `-v` deletes the
> `devdigest_pgdata` volume along with every real repo and review you've imported.

## Run locally

```sh
# 1. install the agent-browser CLI once (downloads Chrome for Testing)
npm i -g agent-browser && agent-browser install
```

### Hermetic (recommended)

```sh
# Boots an isolated, freshly-seeded stack on alternate ports
# (Postgres :5433, API :3101, web :3100), runs the flows, then tears it all
# down. Safe to run while your normal dev stack is up — it never touches your
# dev DB or the devdigest_pgdata volume.
./scripts/e2e.sh
# or: cd e2e && npm install && npm run e2e:hermetic
```

The isolated Postgres is ephemeral (no persistent volume), so every run starts
from an empty database and seeds it from scratch: both seeded repos exist and
every fixture matches the current `server/src/db/seed.ts`. That is what the
repo-specific guards and the count-based assertions need.

### Against your own running stack

Only safe if your dev DB was seeded from the *current* `seed.ts` and the home
redirect happens to land on `acme/payments-api` (see precondition above).
Otherwise prefer the hermetic runner.

```sh
./scripts/dev.sh          # Postgres + API :3001 + web :3000 (seeded)
cd e2e && npm install && npm test
```

Env knobs:

- Runner: `E2E_BASE_URL`, `AGENT_BROWSER_BIN` (default `agent-browser`),
  `E2E_STEP_TIMEOUT` (ms, default 60000).
- Hermetic stack (`scripts/e2e.sh`): `E2E_PG_PORT` (5433), `E2E_API_PORT` (3101),
  `E2E_WEB_PORT` (3100), `E2E_PG_CONTAINER` (`devdigest-e2e-postgres`),
  `E2E_PG_IMAGE` (`pgvector/pgvector:pg16`).

Failure screenshots are written to `e2e/test-results/` (git-ignored; uploaded as
a CI artifact by `.github/workflows/e2e-web.yml`).

## Coverage (typological, not exhaustive)

| Spec | Flow |
|------|------|
| `01-app-boot` | root → redirect to first repo's PR list → seeded PR #482 |
| `02-repo-pulls-detail` | PR list → open PR #482 → review detail route |
| `03-agents` | agents list renders the seeded reviewer agents |
| `04-pr-findings` | PR #482 → Agent runs tab → seeded run verdict + findings; expand → FindingCard |
| `05-pr-diff` | PR #482 → Files changed tab → seeded file renders in the diff viewer |
| `06-onboarding` | `/onboarding` → add-repository form renders (no submit) |
| `07-settings` | `/settings/api-keys` + `/settings/models` → section titles render |
| `08-findings-popover-severity` | hover/focus a severity chip → FindingsPopover scoped to that severity; sticky scope, Escape closes |
| `09-disclosure-a11y` | `Collapse` disclosures: `aria-expanded` wiring, body unmount after `ddCollapseOut`, Enter on a card trigger |
| `10-run-cost-and-timeline` | cost provenance (bare `$` vs `~$` vs `—`), timeline run badges, trace drawer duration/tokens |
