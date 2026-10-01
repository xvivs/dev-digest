# devdigest-mcp

A local stdio MCP server that lets Claude Code (or any MCP client) use DevDigest: list the review agents, run one on a pull request, read the findings, read a repo's conventions, and read the blast radius of a PR. It is a thin HTTP client of the DevDigest API. It never opens the database and imports no server code (ADR 0026, `specs/07-devdigest-mcp.md`).

| Tool | What it does | Calls |
|---|---|---|
| `list_agents` | agents with id, name, description, model, enabled | `GET /agents` |
| `run_agent_on_pr` | starts one review run (a paid LLM call) and waits for it | `GET /repos`, `GET /agents`, `GET /repos/:id/pulls`, `POST /pulls/:id/review`, `GET /pulls/:id/runs`, `GET /pulls/:id/reviews` |
| `get_findings` | findings of the newest review, or of one `run_id` | `GET /repos`, `GET /repos/:id/pulls`, `GET /pulls/:id/reviews`, `GET /pulls/:id/runs` |
| `get_conventions` | accepted (or all) convention rules of a repo | `GET /repos`, `GET /repos/:id/conventions` |
| `get_blast_radius` | blast radius map of a PR (same map as the Overview tab): changed symbols, downstream callers, endpoints, crons | `GET /repos`, `GET /repos/:id/pulls`, `GET /pulls/:id/blast` |

Those eight endpoints are the whole surface. `src/api/client.ts` is the only file that calls `fetch`.

## Run

The DevDigest API must be running for tool calls (`./scripts/dev.sh`, or the manual bring-up in the root `INSIGHTS.md`). The MCP server itself starts without it: reachability is checked per tool call.

```sh
cd mcp && pnpm install
pnpm start          # convenience only: pnpm prints a banner to stdout, so do not use it as an MCP launcher
pnpm typecheck
pnpm test
```

If `pnpm <script>` dies with `ERR_PNPM_IGNORED_BUILDS` (pnpm 11), set every key under `allowBuilds:` in the untracked `mcp/pnpm-workspace.yaml` to `false`, or call the binaries directly: `./node_modules/.bin/tsx src/index.ts`, `./node_modules/.bin/vitest run`.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://127.0.0.1:3001` | API **origin**. A path part (`http://host:3001/api`) is dropped, because paths are joined with `new URL('/…', base)`. |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `600000` | How long `run_agent_on_pr` waits before it returns `status: "running"` with the `run_id`. |
| `DEVDIGEST_MCP_POLL_INTERVAL_MS` | `2000` | Delay between run polls. |
| `DEVDIGEST_MCP_HTTP_TIMEOUT_MS` | `180000` | Per-request timeout. High because `GET /repos/:id/pulls` syncs from GitHub before it answers. |

Logs go to stderr only. stdout carries MCP frames and nothing else.

## MCP Inspector

```sh
cd mcp && pnpm inspect    # npx -y @modelcontextprotocol/inspector@2.9.0 ./node_modules/.bin/tsx src/index.ts
```

The Inspector version is pinned, so `npx` does not run whatever is newest that day. Its default request timeout is far shorter than a review run. Before calling `run_agent_on_pr` from the Inspector, raise the request timeout in its configuration panel above `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, or lower that variable. `list_agents` works with the defaults.

## Connect Claude Code

The repo root `.mcp.json` declares a project-scope server named `devdigest`:

```json
"command": "sh",
"args": ["-c", "cd \"$CLAUDE_PROJECT_DIR/mcp\" 2>/dev/null || cd mcp || exit 1; exec ./node_modules/.bin/tsx src/index.ts"]
```

`sh` reads `CLAUDE_PROJECT_DIR`, which Claude Code sets in the spawned server's environment. The `cd` matters: tsx applies mcp's `tsconfig.json` paths (`@devdigest/shared`, `zod`) only when it runs from `mcp/`. Without the variable it falls back to `mcp` relative to the cwd. The launcher is POSIX `sh`; Windows is not supported.

1. `cd mcp && pnpm install` once (the launcher needs `mcp/node_modules/.bin/tsx`).
2. Start `claude` in the repo root and approve the `devdigest` project server when asked.
3. `/mcp` shows it connected.
4. Ask, for example: *"Review PR #3 in owner/name with Security Reviewer and tell me if there are critical findings."* Claude Code calls `list_agents` → `run_agent_on_pr` → `get_findings`.

To answer the approval prompt again (after declining it, or to revoke it): `claude mcp reset-project-choices`.

Repos and PRs are not listed by this server. Use `gh pr list --repo owner/name --state all` or the GitHub MCP for that.

### Recommended permission rules

Put allow rules in your own `.claude/settings.local.json` (not committed):

```json
{ "permissions": { "allow": ["mcp__devdigest__list_agents", "mcp__devdigest__get_conventions"] } }
```

- `mcp__devdigest__get_findings`: allow it only if you accept the side effects of PR lookup. It calls `GET /repos/:id/pulls`, which syncs the repo's PRs from GitHub, writes PR rows and, with `automatic_brief` on in DevDigest Settings, can queue up to 10 LLM brief jobs per call. These are the same writes opening the PR list in the UI causes.
- `mcp__devdigest__get_blast_radius`: the same caveat as `get_findings` applies, because it resolves the PR through `GET /repos/:id/pulls` (GitHub sync). Allow it only if you accept that. The map is not capped, so a very large PR can exceed the client's tool-output limit; raise `MAX_MCP_OUTPUT_TOKENS` in Claude Code if the result is cut.
- Never auto-allow `mcp__devdigest__run_agent_on_pr` (every call starts a paid LLM run) and never `mcp__devdigest__*`.

## Errors

Every failure is a tool result with `isError: true` and a `Next step:` sentence. The main ones:

| Situation | What the tool says |
|---|---|
| API not running | not reachable at `<url>`; start it with `./scripts/dev.sh`, check `DEVDIGEST_API_URL` |
| repo not imported | import it in the DevDigest UI |
| PR not found | check the number with `gh pr list --repo <repo> --state all`; DevDigest syncs only with a GitHub token, while GitHub is reachable, and only the 50 most recently updated PRs |
| unknown or ambiguous agent | lists every valid agent name |
| disabled agent | enable it in DevDigest → Agents; no run is started |
| run failed or cancelled | the run's error, JSON-quoted and cut at 300 chars; the next step depends on the cause (cancelled, interrupted by a restart, review deadline, LLM key, billing, rate limit, max_tokens, bad model output, setup, else a generic one), classified from the status and error text in `src/run-error.ts` |
| HTTP 422 / 424 from the API | 422 adds the first validation issue (quoted, cut at 200 chars); 424 `config_error` says to add the key in Settings; other 4xx do not point at the API log, 5xx do |
| rate limited | retry after N seconds |

### Rate limits

`POST /pulls/:id/review` allows 10 requests per minute per client IP (`server/src/modules/reviews/routes.ts:32`). Every other route shares the global 120 per minute per IP (`server/src/app.ts:119`), including the browser UI's own polling. A route with its own `config.rateLimit` gets only its own limit, not the global one as well.

On a 429 the API sends a `retry-after` header in whole seconds (the time left in the window, at most 60). This was checked by reading the installed versions, not by firing 11 paid review runs: `@fastify/rate-limit` 11.0.0 sets `retry-after` to `Math.ceil(ttl / 1000)` on an exceeded request by default (`addHeaders` defaults all four headers on, and the per-route config inherits that), and Fastify 5.8.5's error path deletes only `content-type` and `content-length` from headers set before the error. The body is `{"error":{"code":"internal_error","message":"Rate limit exceeded, retry in <n> seconds"}}`, because `app.ts`'s error handler has no 429 branch, so the client classifies a 429 by status. `run_agent_on_pr` never retries the POST and reports `retry-after` (60 s when the header is missing). Run polls wait `retry-after` seconds and keep polling.

## Security notes

- The API binds `0.0.0.0` and has no auth (`server/src/server.ts:30`). Anyone on your LAN can already run reviews and read findings; this server adds no new exposure, but keep `DEVDIGEST_API_URL` on `127.0.0.1` and do not run DevDigest on untrusted networks.
- Finding text, convention rules and agent descriptions come from PR content and model output. The tools return them as JSON data fields, truncated. Tool descriptions, server instructions, messages and next steps are constant templates that interpolate only ids, numbers, repo names and JSON-quoted API text.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Claude Code shows `devdigest` as failed; stderr says `tsx: not found` | run `cd mcp && pnpm install` |
| `Cannot find module '@devdigest/shared'` | the server ran from outside `mcp/`; use the `.mcp.json` launcher, which `cd`s first |
| every tool says the API is not reachable | start the API; check `DEVDIGEST_API_URL` |
| `invalid_response` | the API and this package are out of sync; update both |
| `run_agent_on_pr` returns `status: "running"` | the run outlived `DEVDIGEST_MCP_RUN_TIMEOUT_MS`; call `get_findings` with the `run_id` later |
