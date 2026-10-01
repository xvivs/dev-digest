# Spec: devdigest-mcp (local stdio MCP server, five tools)

**Status:** draft, review loop complete (3 rounds: plan-critic ACCEPT, architecture-reviewer APPROVE); awaiting human approval · **Branch:** `feat/l04-lab` · **Approach:** fixed by the human in the delegation brief (L04, `README.md:85`): a new standalone package `mcp/` that is a thin HTTP client of the DevDigest API, built on `@modelcontextprotocol/sdk@1.31.0` (v1, `McpServer.registerTool` + `StdioServerTransport`), five tools, `get_blast_radius` an honest stub.

Every `path:line` below was re-read on 2026-10-01 against `feat/l04-lab` @ `741ab8c`. SDK facts come from the unpacked `@modelcontextprotocol/sdk@1.31.0` npm tarball (`dist/esm/…`). Claude Code facts come from `https://code.claude.com/docs/en/mcp.md`, `permissions.md` and `env-vars.md`, fetched 2026-10-01.

## Definition of Done

| # | Done when | AC | Checked by |
|---|---|---|---|
| DoD-1 | MCP Inspector lists all five tools, each with its input and output schema as in "Tool contracts" | AC-1, AC-25 | `test/contract.test.ts` + step 10 (Inspector) |
| DoD-2 | devdigest-mcp starts with its own command, the `.mcp.json` launcher (D15), without `./scripts/dev.sh`. `cd mcp && pnpm start` is a convenience for running it by hand, not the stdio contract: pnpm prints a banner to stdout | AC-27 | step 7 (stdio smoke with no API running) |
| DoD-3 | Claude Code completes `list_agents` → `run_agent_on_pr` → `get_findings` on the target prompt | AC-26 | step 10 |
| DoD-4 | An unknown agent lists every valid agent name. An unknown PR says how to get the number with `gh` and why the PR may not be synced yet | AC-7, AC-6 | `test/resolve.test.ts`, `test/results.test.ts` |

## Problem & Motivation

DevDigest reviews a PR only through its web UI. A developer working in Claude Code has to switch to the browser, start a run, wait, and copy findings back. If they ask Claude Code "is PR #3 safe?", the model guesses from the diff instead of using the review DevDigest already ran or could run.

L04 asks for an MCP server that exposes DevDigest's real data to Claude Code. The target scenario: the user says *"Review PR #3 in repo X with Security Reviewer and tell me if there are critical findings"*. Claude Code calls `list_agents` → `run_agent_on_pr` → `get_findings`, and the answer quotes real DevDigest findings.

Runs must execute inside the API process. `runBus` is a module-level singleton and boot reaping assumes one API instance per database (`AGENTS.md` Gotchas, ADR 0020). So the MCP server cannot open the DB or import server modules. It talks to the HTTP API.

## Goals / Non-goals

### Goals

- G1. A `mcp/` package with its own `package.json` and `pnpm-lock.yaml`. It starts on its own (`pnpm start` / Inspector / Claude Code). It is not part of `./scripts/dev.sh`.
- G2. Five tools with final names, input schemas, output schemas, annotations and descriptions: `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`.
- G3. A code-level permission boundary. A typed `DevDigestApi` client exposes exactly seven method+path pairs. No other API call is reachable from a tool.
- G4. Every failure is a tool result with `isError: true` and a next step. stdout carries only MCP protocol frames.
- G5. Project-scope wiring through root `.mcp.json`, a CI workflow, `mcp/README.md` and ADR 0026.

### Non-goals

- `list_prs`, `list_repos` or any other tool beyond the five. PR and repo listing comes from `gh` or the GitHub MCP.
- Any change to `server/` HTTP routes, the DB, or the vendored shared contracts.
- The real `get_blast_radius` over `GET /pulls/:id/blast` (homework; see "Future step: real get_blast_radius").
- Conventions extraction, finding accept/dismiss, run cancel/delete, posting GitHub comments, agent/repo writes, resync.
- Auth for the API, and binding the API to loopback (it is a server change; see Risks).
- MCP resources, prompts, HTTP/SSE transport, Windows support for the `.mcp.json` launcher.

### Decisions

- **D1 [DECIDED].** Standalone `mcp/` package, no workspace, own `package.json` + `pnpm-lock.yaml`. Thin HTTP client, default base URL `http://127.0.0.1:3001`, override `DEVDIGEST_API_URL`. No DB access and no `server/src/modules/**` imports.
- **D2 [DECIDED].** `@modelcontextprotocol/sdk` pinned exactly `1.31.0`. It is the newest v1 and the `latest` dist-tag; its peer range is `zod ^3.25 || ^4.0`; `LATEST_PROTOCOL_VERSION = '2025-11-25'` (`dist/esm/types.js:2`). `zod` is `^3.25` (resolves 3.25.76 like the server). Not v2 `@modelcontextprotocol/server` (needs zod ^4.2).
- **D3 [DECIDED].** `@devdigest/shared` resolves through tsconfig `paths` to `../server/src/vendor/shared/index.ts`, as in `reviewer-core/tsconfig.json`. Only the bare `zod` is mapped to `./node_modules/zod`, so the shared files type-check against mcp's zod. Unlike reviewer-core, `zod/*` is **not** mapped. SDK 1.31.0's `.d.ts` files import `zod/v4` and `zod/v3`, and those must resolve through zod's `exports` map. With `zod/*` mapped, tsc ran 90 s and died out of memory (plan-critic reproduced it with sdk 1.31.0, zod 3.25.76 and typescript 5.7.2). With only the bare mapping it finished in 0.5 s. The shared files import only bare `'zod'`.
- **D4. How shared contracts are reused.** Response schemas are built with `.pick()` from the shared schemas, taking only the fields a tool reads. zod 3 `.pick()` is shallow, so nested arrays and objects are re-picked with `.extend()`. `src/api/schemas.ts` defines exactly these schemas and exports each one plus its `z.infer` type:

  | Schema | Built as |
  |---|---|
  | `RepoLite` | `Repo.pick({id, full_name})` (`contracts/platform.ts:144`) |
  | `PrLite` | `PrMeta.pick({id, number})` (`:161`) |
  | `AgentLite` | `Agent.pick({id, name, description, model, enabled})` (`contracts/knowledge.ts:317`) |
  | `RunLite` | `RunSummary.pick({run_id, agent_id, agent_name, status, error, duration_ms, findings_count, cost_usd, ran_at})` (`contracts/trace.ts:118`) |
  | `StartReviewLite` | `ReviewRunResponse.pick({pr_id}).extend({ runs: z.array(ReviewRunTarget.pick({run_id, agent_id, agent_name})) })` (`contracts/review-api.ts:47,54`) |
  | `FindingLite` | `FindingRecord.pick({severity, title, file, start_line, end_line, rationale, suggestion, confidence, accepted_at, dismissed_at}).extend({ category: z.string() })` (`review-api.ts:17`) |
  | `ReviewLite` | `ReviewRecord.pick({id, run_id, agent_name, verdict, summary, score, created_at}).extend({ findings: z.array(FindingLite) })` (`review-api.ts:25`) |
  | `ConventionsLite` | `z.object({ last_scan: ConventionScan.pick({status, finished_at}).nullable(), candidates: z.array(ConventionCandidate.pick({status, rule, confidence}).extend({ category: z.string(), evidence: z.array(ConventionEvidence.pick({path, line_start})) })) })` (`knowledge.ts:199-262`) |

  `severity` (`Severity`), `verdict` (`Verdict`), candidate `status` and scan `status` stay strict shared enums, because tool logic branches on them. `category` is relaxed to `z.string()` because tools only pass it through. `kind`, `origin`, `skills` and every other field are not picked, so a new enum value there cannot break a tool. Reason: the contracts are the single source of truth (ADR 0007), and narrow picking keeps unrelated drift from breaking a tool. Zod objects strip unknown keys by default. Picked schemas only `.parse()` API JSON, in every environment (ADR 0007's dev-only rule is scoped to the client `apiFetch`). They are never passed to the MCP SDK. Tool input and output schemas are local zod objects in `mcp/src/tools/*`, built with mcp's own zod instance.
- **D5. One zod instance.** Under tsx, `paths` apply to every transformed file, including `../server/src/vendor/shared/**`. So the shared files get mcp's zod even when `server/node_modules` exists (verified empirically by researcher with tsx 4.21). Vitest does not read tsconfig `paths`. It resolves `zod` from the importer's directory first, which is `server/node_modules` when present. `mcp/vitest.config.ts` therefore aliases both `@devdigest/shared` and `zod` (to `mcp/node_modules/zod`) so tests and runtime share one instance.
- **D6. Package layout** (no onion rules apply outside `server/`, but the same inward direction is kept):

  | File | Role | May import |
  |---|---|---|
  | `src/index.ts` | entrypoint: config → `DevDigestApi` → `buildServer` → `StdioServerTransport` | everything below |
  | `src/server.ts` | `buildServer(deps): McpServer`. Registers the five tools and `instructions`. | tools, results |
  | `src/tools/<name>.ts` | one file per tool: input shape, output shape, description, annotations, handler. Every handler body is `try { … return ok(x) } catch (e) { return toToolResult(e) }`. | api (type), resolve, poll, project, results, errors |
  | `src/errors.ts` | `ToolError(kind, message, nextStep)` for every catalogue kind that is not an API failure (`repo_not_found`, `ambiguous_repo`, `pr_not_found`, `agent_not_found`, `ambiguous_agent`, `agent_disabled`, `run_failed`, `run_not_found`, `review_not_found`). The message/next-step templates are constructor functions here, so `get_findings` and `poll.ts` produce the same wording. | — |
  | `src/resolve.ts` | `resolveRepo`, `resolvePr`, `resolveAgent` over the `DevDigestApi` interface; throw `ToolError` | api (type), errors |
  | `src/run-status.ts` | pure `runPhase(status: string \| null): 'pending' \| 'done' \| 'failed'` (`done` → done; `failed`/`cancelled` → failed; `running`, null and unknown → pending). The one classifier for poll.ts and `selectReview`. A leaf module. | — |
  | `src/poll.ts` | `waitForRun(...)` with injected `sleep`/`now`; throws `ToolError`; retries when `isTransient(e)` is true and honours `retryAfterSec` | api (type), errors, api/errors, run-status |
  | `src/project.ts` | pure projections, truncation, severity filter, counts. Each projection function declares its return type as the tool's `z.infer<typeof XOutput>`, because excess-property checks apply only to fresh literals | `api/schemas` and the tools' `*Output` types (`import type` only), `run-status` |
  | `src/results.ts` | `ok<T extends Record<string, unknown>>(structured: T)`. Each tool calls it as `ok<z.infer<typeof XOutput>>(…)`, so tsc checks the projection against the output schema, which SDK v1 does not type (`ToolCallback<InputArgs>` only); `toToolResult(err: unknown): CallToolResult`, the single translation point: `ToolError` → its kind; each `ApiError` kind → the catalogue row (429 by status, D10); anything else → `api_error` "unexpected error" | errors, api/errors, SDK types (type-only) |
  | `src/api/client.ts` | `export interface DevDigestApi` (methods return the `*Lite` types) and `class HttpDevDigestApi implements DevDigestApi`: the only `fetch` caller | api/schemas, api/errors |
  | `src/api/schemas.ts` | picked shared schemas + inferred types (D4); the only runtime import of `@devdigest/shared` | `@devdigest/shared` |
  | `src/api/errors.ts` | `ApiError` with `kind: unreachable \| http \| timeout \| invalid_response`, `status`, `code`, `message`, `retryAfterSec`, `transient` (true for unreachable, timeout, 429 and 5xx), plus the template inputs `baseUrl`, `endpoint` (method + path template such as `GET /pulls/:id/runs`, never the substituted id), `timeoutMs` and `issuePath?`, all set by `HttpDevDigestApi`; exports `isTransient(e: unknown)`. The catalogue wording lives in `results.ts`. A leaf module that any layer may import. | — |
  | `src/config.ts` | env → frozen `McpConfig` | zod |
  | `src/log.ts` | `log.info/warn/error` → `process.stderr` only | — |
  | `src/deps.ts` | `ToolDeps` (`api`, `config`, `sleep`, `now`): the handler dependencies; a type-only leaf, so tools and `server.ts` share it without a cycle | `import type` only: api/client, config, poll |
  | `src/tools/args.ts` | input fields shared by tools (`repo`, `pr_number`) and the severity-counts output object | zod |

- **D7. `DevDigestApi` surface (the permission boundary).** An interface plus one class (`HttpDevDigestApi`, constructor `(baseUrl, httpTimeoutMs, fetchImpl = fetch)`) with exactly these seven public methods and no generic `request(method, path)` export. The private `#get`/`#post` helpers are not reachable from outside the class.

  | Method | HTTP |
  |---|---|
  | `listRepos()` | `GET /repos` |
  | `listPulls(repoId)` | `GET /repos/:id/pulls` |
  | `listAgents()` | `GET /agents` |
  | `startReview(prId, agentId)` | `POST /pulls/:id/review` body `{ agentId }` |
  | `listRuns(prId)` | `GET /pulls/:id/runs` |
  | `listReviews(prId)` | `GET /pulls/:id/reviews` |
  | `getConventions(repoId)` | `GET /repos/:id/conventions` |

  Path ids come only from ids the API returned, and the client still passes them through `encodeURIComponent`. The base URL is joined with `new URL(path, base)`.
- **D8. HTTP timeout.** Each call uses `AbortSignal.timeout(DEVDIGEST_MCP_HTTP_TIMEOUT_MS)`, default 180 000 ms. Reason: `GET /repos/:id/pulls` syncs from GitHub on every call when a token is set. The list call has a 30 s timeout per attempt with 3 retries (`server/src/adapters/github/octokit.ts:18,72`, `server/src/platform/resilience.ts:47-49`), followed by up to 10 serial backfills (`server/src/modules/pulls/routes.ts:96-118`). A timeout maps to `ApiError{kind:'timeout'}`.
- **D9. Run polling.** Poll `GET /pulls/:id/runs` every `DEVDIGEST_MCP_POLL_INTERVAL_MS` (default 2000) until the run's status is terminal, or until `DEVDIGEST_MCP_RUN_TIMEOUT_MS` (default 600 000) has passed. Terminal statuses are `done | failed | cancelled`. `running`, `null` and unknown strings count as not terminal. `queued` is never written (`server/src/modules/reviews/repository/run.repo.ts:13,197`). A 429 or 5xx on a poll waits one more interval and keeps polling. A `retry-after` header, when present, sets the wait (in whole seconds), floored at one poll interval: the wait is never shorter than `DEVDIGEST_MCP_POLL_INTERVAL_MS`, so `retry-after: 0` cannot cause a tight loop. A run id that is missing from the list for 3 polls in a row fails with `run_not_found`. `extra.signal` aborts the loop and, combined with the HTTP timeout through `AbortSignal.any`, the in-flight `listRuns`/`listReviews` request as well.
- **D10. Rate limit.** `POST /pulls/:id/review` allows 10 per minute (`server/src/modules/reviews/routes.ts:32`). The global limit is 120 per minute (`server/src/app.ts:118-119`), keyed by IP by default (`defaultKeyGenerator = (req) => req.ip`). OQ-4, verified statically on 2026-10-01 from the `@fastify/rate-limit@11.0.0` and `fastify@5.8.5` tarballs (the versions in `server/pnpm-lock.yaml`; no live POSTs fired): a route with an object `config.rateLimit` gets only its merged own limit, not the global one too; on an exceeded request the plugin sets `retry-after: Math.ceil(ttl / 1000)` (whole seconds, at most 60 here) because `addHeaders` defaults all four headers on and the route config inherits them; Fastify's `handleError` deletes only `content-type` and `content-length`, so the header reaches the client. A 429 reaches the client as `{error:{code:'internal_error', message}}` because the error handler has no 429 branch (`server/src/app.ts:182-186`). The client therefore classifies 429 by HTTP status, not by `code`. The MCP never retries a POST.
- **D11. Disabled agents.** A single `agentId` skips the `enabled` check (`server/src/modules/reviews/service.ts:51-55`), so `run_agent_on_pr` refuses a disabled agent itself before any POST.
- **D12. Output budget.** `get_findings` `limit` defaults to 20 and is capped at 50. `rationale` is cut at 600 chars, `suggestion` at 300, finding `title` at 200 and review `summary` at 1500, each ending in `…` when cut. `get_conventions` returns at most 50 rules, each with at most 2 evidence items, and `rule` is cut at 400 chars. Typical output stays under 10 000 tokens, the Claude Code warning threshold (docs: `MAX_MCP_OUTPUT_TOKENS` default 25 000, warning above 10 000).
- **D13. Text plus structured content.** A success result carries `content: [{type:'text', text: JSON.stringify(structured)}]` (compact, no indentation) and `structuredContent: structured`. An error result carries `isError: true` and one text block: `"<message> Next step: <nextStep>"`. It has no `structuredContent`. The SDK skips output validation when `isError` is set (`server/mcp.js:193`).
- **D14. Output schemas are flat `z.object`s.** They are not unions, because MCP `outputSchema` must be an object schema. Non-error states (`running`, `not_implemented`) are values of a `status` enum on the same object, with optional fields. The SDK rejects a non-error result without `structuredContent` (`server/mcp.js:197`), so every non-error path returns one.
- **D15. Launcher in `.mcp.json`.** See "Deviations from brief", item 1. `command: "sh"`, `args: ["-c", "cd \"$CLAUDE_PROJECT_DIR/mcp\" 2>/dev/null || cd mcp || exit 1; exec ./node_modules/.bin/tsx src/index.ts"]`, `env: { "DEVDIGEST_API_URL": "${DEVDIGEST_API_URL:-http://127.0.0.1:3001}" }`. The `$CLAUDE_PROJECT_DIR` without braces is left to `sh`. Claude Code sets that variable in the spawned server's environment (docs only). If it is missing, the launcher falls back to `mcp` relative to the cwd. If that also fails, it exits 1 and Claude Code shows the server as failed.
- **D16. Package manager.** pnpm, per D1. Assumed: CI uses `pnpm/action-setup@v4` with `version: 10`, the same as `server-unit.yml`. The local pnpm 11.5.3 preflight (`ERR_PNPM_IGNORED_BUILDS`, root `INSIGHTS.md:44,46,71`) will hit `mcp/` too, because `tsx` pulls `esbuild`. Verification commands in this spec therefore call `./node_modules/.bin/*` directly.
- **D17. Inspector.** The `inspect` script pins the Inspector exactly: `npx -y @modelcontextprotocol/inspector@<X.Y.Z> ./node_modules/.bin/tsx src/index.ts`. The implementer reads `<X.Y.Z>` from `npm view @modelcontextprotocol/inspector version` at step 1 and writes it into the script and the README. An unpinned `npx` would execute whatever version is newest that day.
- **D18. Guard and human-owned files.** `.claude/hooks/agent-guard.mjs` has no `mcp` entry in `TEST_PATHS`, `PACKAGES` or the `specs` profile (`.claude/hooks/agent-guard.mjs:38-48,68`). `.claude/**`, `AGENTS.md` and `CLAUDE.md` are protected (`:56-66`). So the implementer (`impl` profile) writes the tests in the test plan, and the `test-writer` stage does not add mcp tests. Decided (OQ-3): no change under `.claude/` is planned. `mcp/AGENTS.md` and its `CLAUDE.md` stub are proposals (see "Proposals for human-owned files").
- **D19. ADR.** No template file exists in `docs/adr/`. ADR 0026 follows the shape of ADR 0020/0025: Status, Date, Context, Decision, Consequences (enables / costs / forbids), Alternatives considered. 0026 is free on every local branch (checked with `git ls-tree` over all refs). Root `INSIGHTS.md:23` warns that parallel branches collide, so re-check before merge.
- **Assumed:** the stdio server's cwd is not documented by Claude Code. D15 does not depend on it.
- **Assumed:** Inspector's default request timeout is shorter than a review run. Manual acceptance calls only `list_agents` in Inspector. The README tells the user to raise the Inspector request timeout before calling `run_agent_on_pr` there.

## Tool contracts

All tools take `repo` as `"owner/name"`, regex `^[\w.-]+/[\w.-]+$`, max 200 chars, and `pr_number` as `z.number().int().positive()`. Matching against `Repo.full_name` is case-insensitive and exact. If more than one repo matches, the result is `ambiguous_repo` and lists the ids. That cannot happen inside one workspace today, but it is checked anyway.

Every description starts with a one-line purpose and its trigger words. It is at most 1000 chars and contains no instruction that depends on returned data.

| Tool | Input | Annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) | Output (`structuredContent`) |
|---|---|---|---|
| `list_agents` | `{}` | true / false / true / false | `{ agents: [{id, name, description, model, enabled}] }`, sorted by `name` (the API order is not guaranteed: `server/src/modules/agents/repository.ts:31-41`) |
| `run_agent_on_pr` | `{repo, pr_number, agent: string 1..200}` (agent id, or case-insensitive exact name) | false / false / false / true | `{ run_id, status: 'done'\|'running', agent: {id,name}, repo, pr_number, duration_ms: int\|null, findings_count: int\|null, counts_by_severity?: {CRITICAL,WARNING,SUGGESTION}, cost_usd?: number\|null, next_step }` |
| `get_findings` | `{repo, pr_number, run_id?: uuid, min_severity?: 'CRITICAL'\|'WARNING'\|'SUGGESTION', limit?: int 1..50 = 20}` | true / false / true / **true** (PR resolution syncs GitHub, see below) | `{ status: 'done'\|'running'\|'none', run_id: string\|null, agent: string\|null, verdict: string\|null, score: int\|null, summary: string\|null, counts: {CRITICAL,WARNING,SUGGESTION}, findings: [{severity, category, title, file, start_line, end_line, rationale, suggestion?, confidence, state: 'open'\|'accepted'\|'dismissed'}], truncated: boolean, newer_run_in_progress: {run_id: string, agent: string\|null} \| null, next_step?: string }` |
| `get_conventions` | `{repo, status?: 'accepted'\|'all' = 'accepted', category?: string 1..40}` | true / false / true / false | `{ scan: {status: 'running'\|'done'\|'failed', finished_at: string\|null} \| null, rules: [{category, rule, confidence, status, evidence: [{path, line_start}] (≤2)}], truncated: boolean, next_step?: string }` |
| `get_blast_radius` | `{repo, pr_number}` | true / false / true / false | `{ status: 'ok'\|'degraded'\|'unavailable'\|'not_implemented', reason: string\|null, repo, pr_number, summary: string\|null, changed_symbols: [{name, file, kind}], downstream: [{symbol, callers_count, top_callers: [{name, file, line}] (≤5), endpoints_affected: string[], crons_affected: string[]}], truncated: boolean, next_step?: string }` |

**PR resolution is not a pure read.** `GET /repos/:id/pulls` syncs from GitHub (`server/src/modules/pulls/routes.ts:48-79`), upserts PR rows, backfills up to 10 PRs (`:96-118`), and calls `prBrief.scheduleForRepo` (`:81`). With `automatic_brief` on, that can queue up to `AUTO_BRIEF_MAX_PER_SYNC = 10` LLM brief derivations (`server/src/modules/brief/service.ts:224-243`, `brief/constants.ts:10`). These are the same writes the UI's PR list causes. They are bounded per head SHA. So every tool that resolves a PR (`run_agent_on_pr`, `get_findings`, and the future real `get_blast_radius`) is `openWorldHint: true`. `readOnlyHint` stays true for `get_findings`, because it changes no review data. `get_conventions` and `list_agents` do not resolve PRs and stay closed-world. The stub `get_blast_radius` makes no call, so it is `openWorldHint: false` until the homework wires it.

Selection and projection rules. The API reads happen in `src/tools/<name>.ts`. Everything after the reads is pure and lives in `src/project.ts`. That includes `selectReview(runs, reviews, runId?)`, which returns a discriminated outcome: `{kind:'review', review}`, `{kind:'running', run}` (any `runPhase` pending, including a null status), `{kind:'failed', run}`, `{kind:'run_not_found'}`, `{kind:'review_not_found', run}` or `{kind:'none'}`. The tool turns the outcome into `ok(...)` or a `ToolError`. Without `run_id`, the tool reads runs and reviews in parallel.

- **Nulls.** A null `suggestion` is omitted from the finding (the field is `.optional()`). Every other nullable source field keeps `null`, and its output schema uses `.nullable()`: `verdict`, `score`, `summary`, `agent`, `run_id`, `duration_ms`, `findings_count`, `cost_usd`, `scan.finished_at`, `reason`. A null or absent `agent_name` (`.nullish()`, `contracts/review-api.ts:30`) becomes `agent: null` (`?? null`). The same `?? null` rule applies to every `.nullish()` source field.
- `state` is `accepted` when `accepted_at` is set, `dismissed` when `dismissed_at` is set, and `open` otherwise.
- `counts` are computed over all findings of the selected review, before the `min_severity` filter and before `limit`.
- Findings are sorted CRITICAL → WARNING → SUGGESTION, then by `file`, then by `start_line`. `min_severity: 'WARNING'` keeps CRITICAL and WARNING.
- `truncated` is true when `limit` dropped at least one finding (or `get_conventions` dropped at least one rule).
- `get_findings` without `run_id` selects the newest review: `GET /pulls/:id/reviews` returns `createdAt desc` (`server/src/modules/reviews/repository/review.repo.ts:66`). If there is none, the result is `status: 'none'` with `next_step: "call run_agent_on_pr"`.
- **`newer_run_in_progress`.** Without `run_id`, the tool also reads `GET /pulls/:id/runs` (newest first, `run.repo.ts:62`). The field is set to `{run_id, agent: agent_name ?? null}` of the first run whose `runPhase` is pending and that started after the selected review's own run. Comparison: `Date.parse(pending.ran_at) > Date.parse(anchor)`, where `anchor` is the `ran_at` of the run with id `review.run_id`, falling back to `review.created_at` when that run is missing. Using the review's run start rather than `created_at` matters: a run B that started before run A finished is still newer than A's review once A's start is the anchor. A pending run with a null `ran_at` (`ran_at` is notNull in the DB, `server/src/db/schema/runs.ts:28`, but nullable in the contract, `trace.ts:132`) counts as newer. With `status: 'none'`, any pending run counts. Otherwise the field is `null`. When it is set, `next_step` says "a newer run is in progress; call get_findings with run_id <id> later". The field is always `null` when `run_id` is given. A pure `newerRunInProgress(runs, review | null)` in `src/project.ts` computes it. A failed runs read does not fail the tool. The field is then `null`.
- `get_findings` with `run_id` reads `GET /pulls/:id/runs` first. A `running` run gives `status: 'running'` and a `next_step` to call again later. A `failed` or `cancelled` run gives `isError` with the run's `error`. A `done` run selects the review whose `run_id` matches. A review row exists only for a `done` run (`server/src/modules/reviews/run-executor.ts:353-354`). A `run_id` that is not in the PR's runs gives `isError` `run_not_found`. A `done` run with no matching review (it can be removed by `DELETE /reviews/:id`, `server/src/modules/reviews/routes.ts:146`) gives `isError` `review_not_found` with the next step "rerun with run_agent_on_pr".
- `run_agent_on_pr` on `done` reads `GET /pulls/:id/reviews` once and fills `counts_by_severity` from the review whose `run_id` matches. If that read fails, or no review matches, the field is omitted and the result is still a success.
- The stub `get_blast_radius` makes no HTTP call. It validates the input and returns `status: 'not_implemented'`, `reason: null`, empty arrays, `summary: null`, `truncated: false`, and `next_step: "Blast radius is not wired in this lab; open the PR's Overview tab in the DevDigest UI."`

Server `instructions` (≤ 800 chars) say four things: DevDigest is a local AI PR reviewer; use these tools to review a PR, read its findings, check repo conventions, or ask about impact; the canonical order is `list_agents` → `run_agent_on_pr` → `get_findings`; and listing repos or PRs is done with `gh` or the GitHub MCP. They are passed as `new McpServer(info, { instructions })` (`server/index.d.ts:15`, `server/mcp.d.ts:24`).

## Error catalogue

Every row is a tool result with `isError: true` built by `toToolResult(err)` in `src/results.ts`, the single translation point. A handler never lets an exception escape. The SDK would convert one into an `isError` result anyway (`server/mcp.js:135-160`), but without a next step.

| Kind | Trigger | Message → Next step |
|---|---|---|
| `api_unreachable` | `fetch` rejects (ECONNREFUSED, DNS, reset) | "DevDigest API is not reachable at `<base>`." → "Start it with ./scripts/dev.sh; check DEVDIGEST_API_URL." |
| `api_timeout` | D8 timeout | "DevDigest API did not answer within `<n>` s." → "Retry; if it keeps happening, check the API log." |
| `repo_not_found` | no `full_name` match | "Repo `<repo>` is not imported in DevDigest." → "Import it in the DevDigest UI." |
| `ambiguous_repo` | >1 match | lists ids → "Pass the exact owner/name." |
| `pr_not_found` | no `number` match, or a match whose `id` is null (`PrMeta.id` is nullish, `contracts/platform.ts:162`) | "PR #`<n>` is not in DevDigest for `<repo>`." → "Check the number with `gh pr list --repo <repo> --state all` (or `gh pr view <n> --repo <repo>`). If it exists on GitHub, DevDigest could not sync it. This lookup already tried, but DevDigest syncs only when a GitHub token is set in Settings and GitHub is reachable, and only the 50 most recently updated PRs. Add or fix the token, then retry. A PR outside the newest 50 cannot be synced until it is updated on GitHub." The lookup itself is the sync trigger, so opening the UI changes nothing (`server/src/modules/pulls/routes.ts:31,39-50,80-82`, `server/src/adapters/github/octokit.ts:76-83`) |
| `agent_not_found` / `ambiguous_agent` | no match / >1 name match | lists every agent name (and id for ambiguity) → "Pass one of these names or ids." |
| `agent_disabled` | `enabled === false` | "Agent `<name>` is disabled." → "Enable it in DevDigest → Agents, or pick an enabled agent." |
| `rate_limited` | 429 on `POST /pulls/:id/review` | "DevDigest rate limit hit." → "Retry after `<retry-after or 60>` s." |
| `run_failed` | terminal `failed`/`cancelled` | "Run `<id>` `<status>`. Run error (data): " + `JSON.stringify(error cut at 300 chars)` or "none recorded" → "Check the LLM key in DevDigest Settings, then rerun." The run `error` is `(err as Error).message` (`server/src/modules/reviews/run-executor.ts:118,464`) and may carry provider or LLM text, so it is quoted as a JSON string and cut. |
| `run_not_found` | D9, or `get_findings` with an unknown `run_id` | "Run `<id>` is not among this PR's runs." → "Call get_findings without run_id, or rerun." |
| `review_not_found` | `get_findings` on a `done` run whose review was deleted | "Run `<id>` finished but its review no longer exists." → "Rerun with run_agent_on_pr." |
| `api_error` | any other non-2xx | the envelope's `error.message`, JSON-quoted and cut at 300 chars (fallback: `HTTP <status>`), plus `error.code`. The generic handler forwards any exception's message (`server/src/app.ts:182-191`), which can include driver or provider text → "See the DevDigest API log." |
| `invalid_response` | picked schema parse fails | "DevDigest returned an unexpected `<endpoint>` shape: `<first issue path>`." → "The mcp package and the API are out of sync; update both." |

Invalid tool arguments are rejected by the SDK before the handler runs. They come back as an `isError` result with "Input validation error: …" (`server/mcp.js:166-178`, caught at `:135`).

## Acceptance criteria (EARS)

- **AC-1.** When a client calls `tools/list`, the server shall return exactly `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`, each with an `inputSchema` and an `outputSchema`.
- **AC-2.** The server shall give every tool a description of at most 1000 characters, and shall send `instructions` of at most 800 characters that name the sequence `list_agents → run_agent_on_pr → get_findings`.
- **AC-3.** The server shall annotate `list_agents`, `get_conventions` and `get_blast_radius` with `readOnlyHint: true, idempotentHint: true, openWorldHint: false`, `get_findings` with `readOnlyHint: true, idempotentHint: true, openWorldHint: true`, and `run_agent_on_pr` with `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true`.
- **AC-4.** When `list_agents` is called, the server shall return only `id, name, description, model, enabled` per agent, sorted by name, and never `system_prompt`, `provider` or `output_schema`.
- **AC-5.** When a tool gets a `repo` that matches no `full_name` case-insensitively, the server shall return `isError` kind `repo_not_found` without calling any PR endpoint.
- **AC-6.** When a tool gets a `pr_number` that is not in `GET /repos/:id/pulls`, or whose `id` is null, the server shall return `isError` kind `pr_not_found` whose next step names the `gh pr list --repo <repo>` command and gives the reasons a PR may not be synced (no GitHub token, GitHub unreachable, outside the 50 most recently updated PRs).
- **AC-7.** When `run_agent_on_pr` gets an `agent` that matches no id and no name, or matches more than one name, the server shall return `isError` listing every valid agent name and shall not call `POST /pulls/:id/review`.
- **AC-8.** When the resolved agent has `enabled: false`, `run_agent_on_pr` shall return `isError` kind `agent_disabled` and shall not call `POST /pulls/:id/review`.
- **AC-9.** When the started run reaches `done`, `run_agent_on_pr` shall return `status: 'done'` with `run_id`, `duration_ms`, `findings_count`, `counts_by_severity` taken from the review with that `run_id`, and `next_step` naming `get_findings`.
- **AC-10.** When the started run reaches `failed` or `cancelled`, `run_agent_on_pr` shall return `isError` kind `run_failed` that contains the run's `error` as a JSON-quoted string of at most 300 characters.
- **AC-11.** When the run is still not terminal after `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, `run_agent_on_pr` shall return a non-error `status: 'running'` with the `run_id` and a `next_step` to call `get_findings` with that `run_id` later.
- **AC-12.** While polling, if the request carried `_meta.progressToken`, the server shall send one `notifications/progress` per poll with a strictly increasing `progress`. If it did not, the server shall send none.
- **AC-13.** When the request's `extra.signal` aborts, the poll loop shall stop within one interval and shall make no further HTTP call.
- **AC-14.** When `POST /pulls/:id/review` answers 429, the server shall return `isError` kind `rate_limited` with the retry delay. When a poll answers 429 or 5xx, the server shall keep polling.
- **AC-15.** When `get_findings` is called without `run_id`, the server shall project the newest review. With a `run_id` it shall project the review of that run. A `running` run gives `status: 'running'`, a `failed`/`cancelled` run gives `isError` with the run error, an unknown `run_id` gives `isError` `run_not_found`, a `done` run without a review gives `isError` `review_not_found`, and no reviews give `status: 'none'`. Without `run_id`, the result shall carry `newer_run_in_progress` = `{run_id, agent}` of a pending run that started after the selected review, or `null`.
- **AC-16.** When `get_findings` gets `min_severity` and `limit`, the server shall filter and cap as in "Projection rules", report `counts` over all findings, set `truncated`, and cut `rationale` at 600, `suggestion` at 300, `title` at 200 and `summary` at 1500 characters.
- **AC-17.** When `get_conventions` is called, the server shall return only `accepted` candidates by default and all with `status: 'all'`, filter by `category` when given, keep at most 2 evidence items as `{path, line_start}`, and return `scan` from `last_scan`. With zero rules it shall add a `next_step` to run extraction in the DevDigest UI.
- **AC-18.** When `get_blast_radius` is called, the server shall return `status: 'not_implemented'` with empty arrays and a `next_step`, and shall make no HTTP call.
- **AC-19.** When the API is unreachable, every tool that calls it shall return `isError` kind `api_unreachable` naming `./scripts/dev.sh` and `DEVDIGEST_API_URL`.
- **AC-20.** When the API returns a non-2xx with an error envelope (other than the cases above), the server shall return `isError` kind `api_error` carrying the envelope `message` as a JSON-quoted string of at most 300 characters.
- **AC-21.** The `DevDigestApi` class shall expose exactly the seven methods in D7. Each shall issue exactly its method+path with every path id URI-encoded, and `fetch` shall appear nowhere in `mcp/src` outside `src/api/client.ts`.
- **AC-22.** `mcp/src` shall contain no `console.log`, `console.info`, `console.debug` or `process.stdout` reference. All logging goes to stderr.
- **AC-23.** When any tool returns a non-error result through the SDK client, its `structuredContent` shall validate against the tool's `outputSchema`, including for source data with `suggestion: null`, `verdict: null`, `score: null` and `findings_count: null`, and its text block shall be the same object as compact JSON.
- **AC-23a.** `mcp/src` and `mcp/test` shall contain no import specifier matching `(^|/)server/src/` and no import of `drizzle-orm`, `postgres`, `pg` or `fastify`. A runtime (non-`import type`) import of `@devdigest/shared` shall appear only in `src/api/schemas.ts`.
- **AC-23b.** When the API returns a finding with an unknown `kind` or `category` value, or a candidate with an unknown `origin`, the picked schemas shall still parse it.
- **AC-24.** When `.github/workflows/mcp.yml` runs on a change under `mcp/**`, `server/src/vendor/shared/**` or the workflow file, it shall install with `pnpm install --frozen-lockfile` and run typecheck and tests in `mcp/`. The lockfile (`lockfileVersion: '9.0'`, the same as `server/` and `client/`) was generated locally with pnpm 11.5.3, while CI pins pnpm 10. An offline `npx pnpm@10 install --frozen-lockfile` (10.34.6) on a copy of `mcp/package.json` + `mcp/pnpm-lock.yaml` passed on 2026-10-01, so no regeneration was needed.
- **AC-25 (manual).** When the dev stack is seeded, MCP Inspector shall list the five tools and `list_agents` shall return the five seeded agents (`server/src/db/seed.ts:508-557`).
- **AC-26 (manual).** When Claude Code runs in the repo with `.mcp.json` approved, an LLM key configured and repo X with PR #3 imported, the prompt *"Review PR #3 in repo X with Security Reviewer and tell me if there are critical findings"* shall produce calls to `list_agents`, `run_agent_on_pr` and `get_findings`, and an answer that cites the returned `run_id` and findings.

- **AC-27.** When the `.mcp.json` launcher (D15) runs with no DevDigest API process and no `./scripts/dev.sh`, the server shall complete `initialize` and `tools/list` over stdio. API reachability is checked per tool call, never at startup.

## Change sites

| # | File | Change | Layer | AC | Risk |
|---|---|---|---|---|---|
| 1 | `mcp/package.json` | new; `"type":"module"`, `private`; deps `@modelcontextprotocol/sdk` `1.31.0` (exact), `zod` `^3.25`; devDeps `tsx ^4.19.2`, `typescript ^5.7.2`, `vitest ^2.1.8`, `@types/node ^22.10.0`; scripts `start`, `inspect`, `test` (`vitest run`), `typecheck` (`tsc --noEmit -p tsconfig.json`) | wiring | AC-24,25 | M: lockfile and supply chain |
| 2 | `mcp/pnpm-lock.yaml` | generated by `pnpm install` only | wiring | AC-24 | L |
| 3 | `mcp/tsconfig.json` | copy of `reviewer-core/tsconfig.json` compiler options; `paths` for `@devdigest/shared`, `@devdigest/shared/*` and bare `zod` only. **No `zod/*`** (D3: it OOMs tsc with SDK 1.31.0); `include: ["src/**/*.ts", "test/**/*.ts"]` | wiring | AC-24 | L |
| 4 | `mcp/vitest.config.ts` | aliases `@devdigest/shared` → `path.resolve(__dirname, '../server/src/vendor/shared')` and `{ find: /^zod$/, replacement: path.resolve(__dirname, 'node_modules/zod') }`. The regex keeps the alias from catching the SDK's `zod/v4` and `zod/v3` imports. (absolute, as `reviewer-core/vitest.config.ts:9`; a relative alias would resolve next to the importer); `include: ['test/**/*.test.ts']`; `environment: 'node'` | wiring | D5 | M: two zod instances if the alias is missing |
| 5 | `mcp/src/config.ts`, `mcp/src/log.ts` | env parsing (`DEVDIGEST_API_URL` must be an http(s) URL; `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, `_POLL_INTERVAL_MS`, `_HTTP_TIMEOUT_MS` positive ints); stderr logger | core | AC-22 | L |
| 6 | `mcp/src/api/client.ts`, `api/schemas.ts`, `api/errors.ts` | `DevDigestApi` (D7), picked schemas (D4), `ApiError` mapping (envelope, 429 + `retry-after`, unreachable, timeout, invalid_response) | infra (driven adapter) | AC-19,20,21 | H: this is the permission boundary |
| 7 | `mcp/src/resolve.ts` | repo / PR / agent resolution | app | AC-5..8 | M |
| 8 | `mcp/src/poll.ts`, `mcp/src/run-status.ts` | `waitForRun` (D9) with injected `sleep(ms, signal)`, `now()`, `onProgress` | app | AC-9..14 | M: timing |
| 9 | `mcp/src/project.ts`, `mcp/src/results.ts`, `mcp/src/errors.ts` | projections, truncation, filter, counts, null rules; `ok` and `toToolResult`; `ToolError` and its message templates | domain / presentation | AC-4,10,15..17,19,20,23 | M: one translation point for all error kinds |
| 10 | `mcp/src/tools/{list-agents,run-agent-on-pr,get-findings,get-conventions,get-blast-radius}.ts` | schemas, descriptions, annotations, handlers | presentation | AC-1..18 | M: description wording is the prompt-injection surface |
| 11 | `mcp/src/server.ts`, `mcp/src/index.ts` | `buildServer({api, config, sleep, now})`; entrypoint with `StdioServerTransport`; on `connect` failure log to stderr and `process.exit(1)` | wiring | AC-1,2,22 | L |
| 12 | `mcp/test/*.test.ts` (seven files, see Test plan) | hermetic tests | test | all non-manual | L |
| 13 | `.mcp.json` (root, new) | `devdigest` server, D15 launcher | wiring | AC-26 | M: Claude Code expansion |
| 14 | `.github/workflows/mcp.yml` (new) | modeled on `reviewer-core.yml` but with pnpm setup from `server-unit.yml`; `permissions: contents: read`; path filter `mcp/**`, `server/src/vendor/shared/**`, `.github/workflows/mcp.yml` | ci | AC-24 | L |
| 15 | `mcp/README.md` (new) | run, Inspector (and its request timeout), connecting to Claude Code, `claude mcp reset-project-choices`, recommended allow rules (`mcp__devdigest__list_agents`, `mcp__devdigest__get_conventions`, `mcp__devdigest__get_blast_radius`; `mcp__devdigest__get_findings` only with the GitHub-sync / `automatic_brief` caveat; never `run_agent_on_pr` or `mcp__devdigest__*`), env vars, LAN warning, troubleshooting (tsx not found = run `pnpm install` in `mcp/`) | docs | AC-25,26 | L |
| 16 | `docs/adr/0026-devdigest-mcp-http-client.md` (new) | from the "ADR 0026 draft" section | docs | — | L |
| 17 | `TESTING.md` | add `mcp` to the per-package command block and note `mcp.yml`'s path filter next to `TESTING.md:91-93` | docs | AC-24 | L |

No change under `server/`, `client/`, `reviewer-core/` or either `vendor/shared` copy.

## Steps

1. **Scaffold the package.** Create change sites 1, 3, 4 and a throwaway `src/index.ts` that builds an `McpServer` and registers one dummy tool with a raw-shape `inputSchema` and `outputSchema`. This surfaces a TS2589 "excessively deep" error from SDK 1.x + zod 3.25 now, not at step 6. Step 6 replaces the file. Pin the Inspector version (D17). Run `cd mcp && pnpm install`. If the pnpm preflight fails with `ERR_PNPM_IGNORED_BUILDS`, fill the untracked `mcp/pnpm-workspace.yaml` `allowBuilds` keys with `false` (root `INSIGHTS.md:71`) and rerun. Check `grep -n '"version"' node_modules/@modelcontextprotocol/sdk/package.json` and `ls node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`.
   If tsc runs out of memory or takes longer than 30 s, check that `zod/*` is absent from `paths` (D3).
   verify: `cd mcp && ./node_modules/.bin/tsc --noEmit -p tsconfig.json` → exit 0 in under 30 s; the grep prints `"version": "1.31.0"`; the `ls` finds the file.
2. **Config, log, API client.** Change sites 5 and 6, with `test/api-client.test.ts`.
   verify: `cd mcp && ./node_modules/.bin/vitest run test/api-client.test.ts` → all pass.
3. **Resolvers.** Change site 7, with `test/resolve.test.ts`.
   verify: `cd mcp && ./node_modules/.bin/vitest run test/resolve.test.ts` → all pass.
4. **Poll loop.** Change site 8, with `test/poll.test.ts` (fake timers / injected sleep).
   verify: `cd mcp && ./node_modules/.bin/vitest run test/poll.test.ts` → all pass.
5. **Projections, errors and result builders.** Change site 9, with `test/project.test.ts` and `test/results.test.ts`.
   verify: `cd mcp && ./node_modules/.bin/vitest run test/project.test.ts test/results.test.ts` → all pass.
6. **Tools, server, entrypoint.** Change sites 10 and 11, with `test/contract.test.ts` and `test/hygiene.test.ts`.
   verify: `cd mcp && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run` → exit 0, all seven test files pass.
7. **Stdio smoke (also proves AC-27: no API, no dev.sh).** Pipe one `initialize` request and one `tools/list` request into the real entrypoint.
   verify: `cd mcp && printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | (cd .. && CLAUDE_PROJECT_DIR="$PWD" DEVDIGEST_API_URL=http://127.0.0.1:9 sh -c 'cd "$CLAUDE_PROJECT_DIR/mcp" 2>/dev/null || cd mcp || exit 1; exec ./node_modules/.bin/tsx src/index.ts') 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=s.trim().split("\n").map(JSON.parse);if(l.length!==2)throw 1;console.log(l[1].result.tools.map(t=>t.name).sort().join(","))})'` → prints `get_blast_radius,get_conventions,get_findings,list_agents,run_agent_on_pr`. Every stdout line parses as JSON (the script throws otherwise).
8. **Wiring and CI.** Change sites 13 and 14.
   verify: `node -e 'const c=require("./.mcp.json");if(!c.mcpServers.devdigest)process.exit(1)'` from the repo root → exit 0; `grep -c "'mcp/\*\*'\|'server/src/vendor/shared/\*\*'" .github/workflows/mcp.yml` → 4 (two filters × push and pull_request). YAML validity is proven by the workflow's first CI run (AC-24).
9. **Docs.** Change sites 15, 16 and 17.
   verify: `ls docs/adr/0026-*.md && grep -c "reset-project-choices" mcp/README.md` → one file, count ≥ 1.
10. **Manual acceptance** (precondition: `./scripts/dev.sh` or the INSIGHTS bring-up at root `INSIGHTS.md:68`, `pnpm db:seed` done, LLM key set in Settings, repo X imported, PR #3 present in its PR list).
    verify (AC-25): `cd mcp && pnpm inspect` → the Inspector lists 5 tools; calling `list_agents` shows the 5 seeded agents.
    verify (AC-26): `claude` in the repo root → approve `devdigest`; `/mcp` shows it connected; run the target prompt; the transcript shows the three tool calls and the answer cites the `run_id`. Record the run id and the outcome in the PR description.
    OQ-4 (rate limit) is not part of step 10. It was checked statically on purpose: the live check needs 11 `POST /pulls/<id>/review` calls, each a paid LLM run, which costs too much for one header. The finding (a 429 carries `retry-after` in whole seconds) is in D10 and `mcp/README.md` ("Rate limits").

## Test plan

All files under `mcp/test/`, plain `*.test.ts` (no DB, so no `*.it.test.ts`).

| AC | Test file | Kind | Case |
|---|---|---|---|
| AC-21 | `mcp/test/api-client.test.ts` | unit, mocked `fetch` | each of the 7 methods issues exactly one call with the expected method and URL; an id `a/b?c` is sent as `a%2Fb%3Fc`; the class's own prototype method names equal the 7 in D7 |
| AC-19 | same | unit | `fetch` rejecting with `TypeError` (cause `ECONNREFUSED`) → `ApiError{kind:'unreachable'}`; an aborted timeout signal → `kind:'timeout'` |
| AC-20, AC-14 | same | unit | 404 envelope → `kind:'http'`, `code:'not_found'`, message kept; 429 with `retry-after: 17` → `retryAfterSec: 17`; 429 with an `internal_error` code still classified as 429; a body failing the picked schema → `kind:'invalid_response'` |
| AC-23b | same | unit | a review whose finding has `kind: 'brand_new_kind'` and `category: 'docs'`, and a candidate with `origin: 'new_origin'`, both parse |
| AC-10, 19, 20 + every catalogue row | `mcp/test/results.test.ts` | unit, pure | `toToolResult` on one `ToolError` per kind (iterating the D6 kind union) and on each `ApiError` kind gives `isError: true` with the catalogue message and next step, with templates rendered (e.g. `api_unreachable` names the `baseUrl`, `api_timeout` the seconds, `invalid_response` the `endpoint` and `issuePath`); a 429 `ApiError` with code `internal_error` maps to `rate_limited`; a run error of 1000 chars containing `"` and newlines is JSON-quoted and cut to 300; an unknown thrown value maps to `api_error` |
| AC-5..8, DoD-4 | `mcp/test/resolve.test.ts` | unit, fake `DevDigestApi` | repo matched case-insensitively; repo missing; PR missing and PR with `id: null`, each with a next step that contains `gh pr list --repo owner/name`, "GitHub token", "50 most recently updated" and no "open the repo" wording; agent by id; agent by mixed-case name; unknown agent lists names; two agents with names that differ only in case → `ambiguous_agent`; disabled agent → `agent_disabled` |
| AC-9..14 | `mcp/test/poll.test.ts` | unit, injected sleep/now | running→done; running→failed (error carried); `cancelled`; timeout → `running`; progress callback called once per poll with increasing `progress`; 429 and 503 on a poll keep polling; run missing 3 times → `run_not_found`; an aborted signal stops with no further `listRuns` call |
| AC-4, 15..17 | `mcp/test/project.test.ts` | unit, pure | `runPhase` for done/failed/cancelled/running/null/'weird'; `selectReview` outcomes by name: newest review without `runId`; `review` for a done run; `running` (also for a null status); `failed` for failed and for cancelled; `run_not_found`; `review_not_found`; `none`; `agent_name` undefined → `agent: null`; `newerRunInProgress`: pending run after the review → `{run_id, agent}`; pending run older than the review's run → null; concurrent runs (B started after A's start but before A's review was written) → B; pending run with null `ran_at` → set; review whose run is missing from the list → `created_at` fallback; done/failed runs only → null; no review + pending run → set; `agent_name` null → `agent: null`; agent projection drops `system_prompt`; severity sort; `min_severity` filter; `limit` and `truncated`; `counts` unfiltered; 600/300-char cut with `…`; `state` from timestamps; conventions default `accepted`, `all`, `category`, evidence ≤ 2; empty rules → `next_step` |
| AC-1..3, 8, 11, 15, 18, 23 | `mcp/test/contract.test.ts` | contract, SDK `Client` + `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js`, fake API | `listTools` returns exactly the 5 names; each description ≤ 1000 and < 2048 chars; `client.getInstructions()` ≤ 800 chars and contains the sequence; annotations per AC-3; `callTool` for each tool on a happy fixture succeeds (the client validates `structuredContent` against `outputSchema` after `listTools`, `client/index.js:475-505,533-535`) and the text block `JSON.parse`s to `structuredContent`; the disabled-agent and unknown-repo paths return `isError: true`; the fake API records no `startReview` call for them; `get_blast_radius` records zero API calls; `run_agent_on_pr` with a timeout of 0 returns `status: 'running'`; a `get_findings` fixture with `suggestion: null`, `verdict: null`, `score: null` and a `run_agent_on_pr` fixture with `findings_count: null` both pass the client's output validation; `get_findings` fixtures for `none`, `running`, and a newest review with a newer pending run (`newer_run_in_progress` set), and with none (`null`), and a `get_conventions` empty-rules fixture pass output validation; `callTool(…, {onprogress})` on `run_agent_on_pr` (two polls before `done`) receives strictly increasing progress, and the same call without `onprogress` receives no progress notification (AC-12) |
| AC-22, AC-21, AC-23a | `mcp/test/hygiene.test.ts` | static | read every `mcp/src/**/*.ts` and `mcp/test/**/*.ts`: no `console.log/info/debug`, no `process.stdout` (src only); `fetch(` only in `src/api/client.ts`; no specifier matching `/(^|\/)server\/src\//`; no specifier matching `^(drizzle-orm|postgres|pg|fastify)(\/|$)`; a non-`import type` import of `@devdigest/shared` only in `src/api/schemas.ts` |
| AC-24 | — | CI | the workflow's first run on the PR is green |
| AC-25, AC-26 | — | manual | step 10 |
| AC-27 | — | smoke | step 7 (`DEVDIGEST_API_URL` points at a dead port; `initialize` + `tools/list` still answer) |

## Edge cases

- `PrMeta.id` null → `pr_not_found` (AC-6).
- A PR older than the 50 most recently updated: the GitHub sync fetches `per_page: 50` with no further pages (`server/src/adapters/github/octokit.ts:76-83`), but the DB read has no state filter (`server/src/modules/pulls/routes.ts:87-90`). A PR synced earlier is still found. One never synced gives `pr_not_found` with the sync hint.
- GitHub sync failure is swallowed by the API (`server/src/modules/pulls/routes.ts:40-44,82-84`). The tool sees persisted PRs only.
- Two agents with case-different names → `ambiguous_agent`. An `agent` equal to one agent's id and another's name: the id wins.
- An `agent` that is not a UUID is matched locally before any POST, so the API never sees a non-UUID `agentId`. It could otherwise reach Postgres and raise a 500 (unverified, `server/src/modules/reviews/service.ts:52`).
- The run row is created before `POST` returns (`server/src/modules/reviews/service.ts:111-122`), so the first poll sees it.
- The API restarts mid-poll: boot reaping sets the run to `failed` (`run.repo.ts:170`) → `run_failed`. While the API is down, polls fail with `unreachable` and are retried until the timeout. The final result is `api_unreachable` only if the last poll also failed. Otherwise it is `running`.
- `findings_count` null on a done run → returned as null; `counts_by_severity` still comes from the review.
- `retry-after` absent or non-numeric → 60 s in the message, one interval for polls.
- `category` filter value not in the enum: a plain string filter, so it returns zero rules and the empty-rules `next_step`.
- `DEVDIGEST_API_URL` with a trailing path (`http://host:3001/api`): `new URL(path, base)` with a leading `/` drops it. The README states that the base must be an origin.

## Risks & rollback

| Risk | Impact | Mitigation |
|---|---|---|
| Rate limit: 10/min on `POST /pulls/:id/review`, global 120/min per IP shared with the browser UI's own polling | A chatty agent gets 429; polls could hit the global limit with the UI open | POST is never retried and 429 returns `rate_limited` with the delay (AC-14); polls back off on 429 (D9); 2 s interval = 30 req/min per active run |
| Long poll vs the Claude Code tool timeout | The tool call could be cut off | Docs: `MCP_TOOL_TIMEOUT` defaults to ~28 h; the stdio idle timeout is 30 min and progress notifications reset it. Our 10 min default is below both, and on timeout we return `running` + `run_id` (AC-11). Inspector's short default timeout is documented in the README |
| LAN-exposed unauthenticated API (`server/src/server.ts:30` binds `0.0.0.0`, no auth: `server/src/adapters/auth/local.ts:14-37`) | Anyone on the LAN can already run reviews and read findings; the MCP adds no new exposure | Default URL is `127.0.0.1`; the README warns; changing the bind is out of scope (no server changes) and goes to Open questions |
| Prompt injection through finding `rationale`/`suggestion`/`title` or convention `rule`/`path` (PR content is untrusted, and LLM output derived from it is too) | Claude Code could follow text planted in a PR | Outputs are JSON data fields, never instructions; `next_step` and messages are constant templates that interpolate only ids, numbers, repo names, and the JSON-quoted, cut API and run error messages; descriptions and `instructions` contain no data-dependent text; truncation caps the payload; no write tool except `run_agent_on_pr`, which is bounded by the rate limit and needs Claude Code permission (the README allow rules never include it) |
| `run_agent_on_pr` spends LLM money | Unwanted cost | `openWorldHint: true`, `readOnlyHint: false`; the README does not recommend auto-allowing it; it starts exactly one run per call |
| `listPulls` (used by `run_agent_on_pr` and `get_findings`) syncs GitHub, writes PR rows and may queue up to 10 auto-brief LLM jobs per call (`server/src/modules/pulls/routes.ts:81`, `server/src/modules/brief/service.ts:224-243`) | An auto-allowed `get_findings` can reach GitHub and, with `automatic_brief` on, spend LLM money | `get_findings` is `openWorldHint: true` (AC-3); the jobs are bounded per head SHA, and these are the same writes the UI's PR list causes; the README states this next to the allow-rule recommendation and points to the `automatic_brief` setting; the recommended allow rule covers `list_agents` and `get_conventions` unconditionally, and `get_findings` only with that caveat |
| SDK v1 → v2 migration later | Imports and the `registerTool` signature change; v2 needs zod ^4.2 while the shared contracts are zod 3 | SDK use is confined to `src/server.ts`, `src/tools/*`, `src/index.ts`, `src/results.ts` (type-only `CallToolResult`) and `test/contract.test.ts`; ADR 0026 records the trigger (shared contracts on zod 4) |
| API drift: hermetic tests use fixtures, so a server route change is not caught by `mcp.yml` | A tool breaks at runtime | Picked shared schemas fail loudly as `invalid_response` (except the deliberately relaxed pass-through `category`, D4); `mcp.yml` reruns on vendored shared changes; step 10 is the end-to-end check |
| pnpm 11 preflight (`ERR_PNPM_IGNORED_BUILDS`) | `pnpm test` dies locally before running | Verification calls `./node_modules/.bin/*`; `.mcp.json` calls tsx directly; README troubleshooting |
| A dependency or library writes to stdout | Corrupts the stdio protocol | The hygiene test covers our code; step 7 checks that every stdout line is JSON-RPC |

**Rollback:** the change is additive. Delete `mcp/`, `.mcp.json`, `.github/workflows/mcp.yml` and ADR 0026, and revert the `TESTING.md` lines. No DB, server or client state changes. A user who approved the project server runs `claude mcp reset-project-choices`.

## Untrusted inputs

| Input | Source | Sink | Control |
|---|---|---|---|
| tool arguments (`repo`, `pr_number`, `agent`, `run_id`, `category`, `limit`) | the model, which can be steered by any content it read | URL path, local matching | zod (regex, int bounds, uuid, length caps); path ids are never taken from arguments, only from API-returned ids, and are URI-encoded anyway (D7) |
| finding text, convention text, agent `description` | PR diffs via LLM output; repo contents; users | the model's context | data-only JSON fields, truncated (D12); never interpolated into descriptions, `instructions`, messages or `next_step` |
| run `error` | `(err as Error).message` from provider calls or the executor (`run-executor.ts:118,464`) | `run_failed` error text | the one exception: interpolated into the message, but only as a `JSON.stringify`-quoted string cut at 300 chars and labelled "Run error (data)" |
| API error `message` | the server; the generic handler forwards any exception's message, including driver or provider text (`server/src/app.ts:182-191`) | tool error text | JSON-quoted and cut at 300 chars, the same as the run error |
| `DEVDIGEST_API_URL` and other env | the operator | `fetch` base | server-controlled config; must parse as an http(s) URL |

No shell, SQL, filesystem or HTML sink exists in `mcp/src`.

## Relevant INSIGHTS entries

- Root `INSIGHTS.md:44,46,71,77`: the pnpm 11.5.3 preflight `ERR_PNPM_IGNORED_BUILDS`, the `allowBuilds: false` fix, `pnpm_config_verify_deps_before_run=false`, and the `CI` purge. This is why every verify command calls `./node_modules/.bin/*` (D16).
- Root `INSIGHTS.md:79`: reviewer-core is an npm package. Do not copy its `npm ci` CI steps into the pnpm-based `mcp.yml`.
- Root `INSIGHTS.md:68`: `./scripts/dev.sh` may not finish locally. Use the documented manual bring-up for step 10.
- Root `INSIGHTS.md:23`: ADR numbers collide across branches. Re-check 0026 before merge.
- Root `INSIGHTS.md:75`: a missing sibling `node_modules` shows up as `Cannot find module 'zod'` from aliased source. Here `zod` is mapped locally (D3, D5).
- Root `INSIGHTS.md:102`: `tsconfig` `include: src/**` hides test type errors. `mcp/tsconfig.json` includes `test/**` too.
- `server/INSIGHTS.md:52`: a JobRunner retries only on 429/5xx. This is not used here, but it confirms the server-side retry semantics differ from our "never retry the POST".

## ADR 0026 draft — devdigest-mcp is a standalone HTTP client on SDK v1; annotations are not the boundary

**Status:** proposed · **Relates to:** ADR 0001, ADR 0007, ADR 0020; `specs/07-devdigest-mcp.md`

**Context.** L04 adds an MCP server so Claude Code can run DevDigest reviews and read findings. Runs must live in the API process (`runBus` singleton, single-instance reaping, ADR 0020). The vendored shared contracts are zod 3. MCP tool annotations (`readOnlyHint` and the rest) are hints that clients may ignore.

**Decision.**
1. A standalone `mcp/` package that talks to the API over HTTP only. No DB and no server-module imports. Shared contracts are reused by nested `.pick()` through tsconfig paths, as reviewer-core does. `mcp/` becomes the second consumer of the `server/src/vendor/shared` copy (ADR 0001 names only reviewer-core).
1a. mcp parses every API response with picked, non-strict schemas in all environments. ADR 0007's dev-only parse rule is scoped to the client `apiFetch`. Its argument against parsing everywhere was a strict parse that breaks on additive changes, and picked schemas do not. A deliberate exception to ADR 0007's "no loosened schemas" clause: `category` is relaxed to `z.string()` because it is a pass-through field. This is not a drift fix. The enums the tools branch on (`severity`, `verdict`, statuses) stay strict.
2. `@modelcontextprotocol/sdk` 1.31.0 (v1) pinned exactly, because v2 requires zod ^4.2.
3. The permission boundary is code: one `DevDigestApi` class with seven explicit method+path pairs. Annotations only describe it.

**Consequences.** *Enables:* the MCP needs no migration or seed of its own, and the API process stays the single writer. *Costs:* an extra hop and an API that must be running; PR resolution goes through `GET /repos/:id/pulls`, which syncs GitHub and can schedule auto-brief jobs, so PR-resolving read tools are annotated open-world; hermetic tests cannot catch route drift; a second consumer of the vendored contracts; a v2 migration later. *Forbids:* a generic request helper reachable from tools; tool-side DB access; adding an endpoint without a new method and a test.

**Alternatives considered.**

| Option | For | Against |
|---|---|---|
| MCP inside the server process (Fastify plugin + HTTP transport) | no extra hop | ties MCP lifecycle to the API; stdio impossible; needs server changes (forbidden for this lab) |
| MCP with direct DB access | fast reads | a second process would start runs outside the `runBus` owner (ADR 0020) |
| **Standalone HTTP client (chosen)** | isolated, no server change | API drift is only caught at runtime |
| SDK v2 | newer API | zod ^4.2 conflicts with the zod 3 contracts |

## Future step: real get_blast_radius (homework)

Add `getBlast(prId)` → `GET /pulls/:id/blast` to `DevDigestApi` (an eighth allowlisted pair plus a test). Parse with `PrBlastResponse.pick(...)` (`server/src/vendor/shared/contracts/brief.ts:97-107`: `status`, `reason`, `blast{changed_symbols, downstream, summary}`, `truncated`). Map it to the final output schema above: `callers_count = callers.length`, and `top_callers` = the first 5. The `status` and `reason` values pass through. The output schema does not change.

## Proposals for human-owned files (not applied)

- `AGENTS.md` → Commands: `cd mcp && pnpm start   # devdigest-mcp over stdio (needs the API on :3001)` and `cd mcp && pnpm inspect`.
- `AGENTS.md` → Stack: `` `mcp/` — stdio MCP server · @modelcontextprotocol/sdk 1.31 · thin HTTP client of the API ``.
- `AGENTS.md` → Where things live: `` mcp/src/  tools/ · api/client.ts (the only allowed API calls) · server.ts ``.
- `AGENTS.md` → Read when: "Read `mcp/README.md` before changing the MCP tools or `.mcp.json`."
- `mcp/AGENTS.md` + `mcp/CLAUDE.md` (`@AGENTS.md` stub, root `INSIGHTS.md:38`), and `mcp/INSIGHTS.md` through the `engineering-insights` skill once there is something to file.

## Deviations from brief

1. **`.mcp.json` command.** The brief has `${CLAUDE_PROJECT_DIR}/mcp/node_modules/.bin/tsx ${CLAUDE_PROJECT_DIR}/mcp/src/index.ts`. Claude Code expands `${VAR}` from its own environment, and `CLAUDE_PROJECT_DIR` is not in it. The docs say it "requires a default such as `${CLAUDE_PROJECT_DIR:-.}`" (code.claude.com/docs/en/mcp.md, env expansion). Separately, tsx reads `tsconfig.json` from the cwd, and the `@devdigest/shared` and `zod` `paths` apply only when that tsconfig is mcp's (researcher, tsx 4.21, empirical). A cwd at the repo root breaks the shared import. Hence D15: `sh -c 'cd "$CLAUDE_PROJECT_DIR/mcp" 2>/dev/null || cd mcp || exit 1; exec ./node_modules/.bin/tsx src/index.ts'`, where `sh` reads the variable that Claude Code sets in the spawned process. It is still a direct tsx call with no pnpm banner. The `${DEVDIGEST_API_URL:-…}` syntax is confirmed by the docs.
2. **`RunSummary.status` has no `queued`.** It is `z.string().nullable()` (`server/src/vendor/shared/contracts/trace.ts:124`), and nothing writes `queued` (`run.repo.ts:13,197`). Terminal = `done|failed|cancelled`. Everything else keeps polling (D9).
3. **429 is not an error envelope with a rate-limit code.** It arrives as `internal_error` (`server/src/app.ts:182-186`). The client classifies by status (D10). `retry-after` is sent in whole seconds, verified statically on 2026-10-01 (D10).
4. **`PrMeta.id` is nullish** (`contracts/platform.ts:162`). It is handled as `pr_not_found` (AC-6).
5. **`GET /agents` has no defined order** (`server/src/modules/agents/repository.ts:31-41`). `list_agents` sorts by name.
6. **Shared contracts are reused by nested `.pick()`, not whole** (D4). This refines the brief's "reuse … where they exist". Whole schemas would make a tool fail on an unrelated server change: a new `FindingKind` or `ConventionOrigin` value, or a new `Agent.provider`. Only the enums the tools branch on stay strict (`severity`, `verdict`, statuses). `category` is relaxed to a string.
7. **Vitest needs a `zod` alias** (D5). Without it, vitest resolves the shared files' `zod` from `server/node_modules` when that exists, which gives two zod instances.
8. **No ADR template file exists** in `docs/adr/`. ADR 0026 follows ADR 0020/0025 (D19).
9. **The test-writer cannot write `mcp/test/**`** under the current guard (D18). The implementer writes the planned tests. No guard change is planned (OQ-3).
10. **`get_findings` gets `status: 'none'` and `run_agent_on_pr` returns `status: 'done'|'running'` only.** `failed`/`cancelled` are `isError` (as the brief says for failed runs). The output schemas are flat objects with a `status` enum, because the SDK requires `structuredContent` on every non-error result and an object `outputSchema` (D14).
11. **Two env vars added:** `DEVDIGEST_MCP_HTTP_TIMEOUT_MS` (D8, motivated by the GitHub sync latency on `GET /repos/:id/pulls`) and `DEVDIGEST_MCP_POLL_INTERVAL_MS` (D9, for tests and tuning).
12. **`get_findings` is `openWorldHint: true`** (AC-3). The brief had `false`, but PR resolution syncs GitHub and can schedule auto-brief LLM jobs (`server/src/modules/pulls/routes.ts:48-81`, `server/src/modules/brief/service.ts:224-243`).
13. **A new error kind `review_not_found`** for a `done` run whose review was deleted (`server/src/modules/reviews/routes.ts:146`).
14. **`zod/*` is not path-mapped** (D3), unlike `reviewer-core/tsconfig.json`. With SDK 1.31.0 in the program, the wildcard makes tsc run out of memory.
15. **ADR 0001 and ADR 0007 Status lines edited.** Each now ends with "amended by ADR 0026" (`docs/adr/0001-vendored-shared.md:3`, `docs/adr/0007-api-response-validation.md:3`), and ADR 0026 carries "Amends: ADR 0001, ADR 0007". Only those lines changed; the change-site table listed ADR 0026 alone.

## Open questions

- **OQ-1 (CLOSED).** Binding the API to `127.0.0.1` is a separate follow-up and out of scope.
- **OQ-2 (CLOSED).** pnpm (D1, D16).
- **OQ-3 (CLOSED).** The implementer writes the tests. No change under `.claude/` is planned (D18).
- **OQ-4 (CLOSED).** Verified statically from the `@fastify/rate-limit@11.0.0` and `fastify@5.8.5` sources instead of 11 paid live runs; see D10. The code handles a missing header too (60 s fallback).
- **OQ-5 (CLOSED).** Return the newest finished review plus `newer_run_in_progress: {run_id, agent} | null` (Tool contracts, AC-15, project/contract tests).

## Review log

| Round | Reviewer | Finding | Severity | Resolution |
|---|---|---|---|---|
| 1 | plan-critic | PC-1 read tools trigger GitHub sync / auto-brief | MAJOR | fixed in Tool contracts ("PR resolution is not a pure read"), AC-3, Risks, ADR draft, Deviation 12 |
| 1 | plan-critic | PC-2 nullable fields vs output schemas | MAJOR | fixed in Projection rules ("Nulls"), AC-23, contract test fixture |
| 1 | plan-critic | PC-3 relative vitest zod alias | MINOR | fixed in change site 4 |
| 1 | plan-critic | PC-4 progressToken gating not tested at SDK level | MINOR | fixed in Test plan (contract.test.ts) |
| 1 | plan-critic | PC-5 run `error` interpolated | MINOR | fixed in Error catalogue, AC-10, Untrusted inputs, results.test.ts |
| 1 | plan-critic | PC-6 shallow pick | MINOR | fixed in D4 table, Deviation 6, AC-23b |
| 1 | plan-critic | PC-7 done run without review | MINOR | fixed in Projection rules, catalogue `review_not_found`, AC-15 |
| 1 | plan-critic | OQ: TS2589 with SDK 1.x + zod 3.25 | open question | fixed in step 1 (dummy tool typechecked early) |
| 1 | architecture-reviewer | AR-1 annotations misdescribe PR resolution | LOW | fixed (same as PC-1) |
| 1 | architecture-reviewer | AR-2 shallow pick | MEDIUM | fixed (same as PC-6) |
| 1 | architecture-reviewer | AR-3 projection types vs picked types | LOW | fixed in D6 (`api/schemas` exports types; interface in `api/client.ts`) |
| 1 | architecture-reviewer | AR-4 no single ApiError → catalogue mapping | MEDIUM | fixed in D6 (`src/errors.ts`, `toToolResult`), catalogue intro, results.test.ts |
| 1 | architecture-reviewer | AR-5 ADR 0026 vs ADR 0007 parse mode | LOW | fixed in ADR draft decision 1a |
| 1 | architecture-reviewer | AR-6 no mechanical "no server imports" check | LOW | fixed in AC-23a and hygiene.test.ts |
| 1 | architecture-reviewer | OQ: ADR 0001 second consumer | open question | fixed in ADR draft decision 1 |
| 1 | architecture-reviewer | OQ: results.ts uses SDK types | open question | fixed in Risks (SDK confinement list) |
| 2 | architecture-reviewer | AR-1 (r2) "pure" projection heading contains API reads; AC-15 branches untested by name | LOW | fixed: heading retitled, pure `selectReview` outcome, named cases in project.test.ts |
| 2 | architecture-reviewer | AR-2 (r2) output schema not linked to projection type | LOW | fixed: generic `ok<T>` with `z.infer<typeof XOutput>`; extra contract fixtures |
| 2 | architecture-reviewer | AR-3 (r2) poll.ts needs runtime `api/errors` | LOW | fixed in D6 (`isTransient`, leaf module) |
| 2 | architecture-reviewer | OQ: `agent_name` nullish → `?? null` | open question | fixed in Nulls rule |
| 2 | architecture-reviewer | OQ: Deviations numbering | cosmetic | fixed (reordered) |
| 2 | plan-critic | PC-1..PC-7 re-check | — | all resolved (TS2589 probe partially, superseded by PC-8) |
| 2 | plan-critic | PC-8 `zod/*` path mapping OOMs tsc with SDK 1.31.0 (reproduced) | CRITICAL | fixed in D3, change sites 3-4 (`/^zod$/` alias), step 1 remedy, Deviation 14 |
| 2 | plan-critic | PC-9 `api_error` passes an arbitrary exception message uncut | MINOR | fixed in catalogue, AC-20, Untrusted inputs |
| 2 | plan-critic | PC-10 launcher has no fallback without `CLAUDE_PROJECT_DIR` | MINOR | fixed in D15 and Deviation 1 |
| 3 | plan-critic | ACCEPT; PC-8..10 resolved (re-run in probe) | — | — |
| 3 | plan-critic | PC-11 `ok<T>` misses extra keys on non-literal values | MINOR | fixed in D6 (projection return types = `z.infer<typeof XOutput>`) |
| 3 | architecture-reviewer | APPROVE | — | — |
| 3 | architecture-reviewer | AR-1 (r3) `ApiError` lacks catalogue template inputs | LOW | fixed in D6 `api/errors.ts` (baseUrl, endpoint, timeoutMs, issuePath) + results.test.ts |
| 3 | architecture-reviewer | AR-2 (r3) `review_not_found` missing from ToolError kinds | LOW | fixed in D6 |
| 3 | architecture-reviewer | AR-3 (r3) run-status classification duplicated; null status unspecified in `selectReview` | LOW | fixed: `src/run-status.ts` `runPhase`, project.test.ts cases |
| 3 | architecture-reviewer | AR-4 (r3) ADR 0007 loosened-schema clause not addressed | LOW | fixed in ADR draft 1a and Risks |
| 3 | architecture-reviewer | OQ `selectReview` signature split | preference | moot: without `run_id` the tool now reads runs anyway, for `newer_run_in_progress` |
| 3 | architecture-reviewer | cosmetic `review-api.ts:53` → `:54` | cosmetic | fixed |
| 4 (delta, human edits) | plan-critic | PC-1 (r4) `pr_not_found` says to open the UI, but the lookup already triggers the sync | MAJOR | fixed in catalogue + AC-6: reasons are now no token, GitHub unreachable, outside newest 50; resolve.test.ts assertion updated |
| 4 | plan-critic | PC-2 (r4) step 7 doesn't run the AC-27 command; `pnpm start` banner | MINOR | fixed: AC-27/DoD-2 name the D15 launcher; step 7 runs it |
| 4 | plan-critic | PC-3 (r4) `newer_run_in_progress` misses concurrent runs | MINOR | fixed: anchor = review's run `ran_at` (fallback `created_at`), `Date.parse`, null `ran_at` counts as newer, extra tests |
