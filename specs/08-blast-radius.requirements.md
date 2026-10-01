# Blast Radius — requirements (source of truth, L04 homework)

> Verbatim brief from the course. Anything currently implemented must be brought
> in line with this document. Design prototype:
> https://claude.ai/artifact/KP2JTS2LE2eDQCTx6MU1hK (screenshots in the session).

## What we build

The reviewer sees the diff but not what else in the repo the change can affect.
The map shows three things:

- which symbols are declared in the changed files;
- who imports or calls those symbols;
- which HTTP endpoints and crons may depend on the changed code.

The data is already computed: `repo-intel` built the index at clone time. The
feature analyses nothing again and calls no model — it reads ready data and
shows it.

Two deliverables:

1. UI block **Blast radius** on the Overview tab of the PR page.
2. `get_blast_radius` tool in the `devdigest-mcp` server so Claude Code sees the
   map without the UI.

Graph view and Prior PRs are optional (P3).

## User stories

- Open a PR → Overview tab → see the Blast radius block.
- See a summary on top: how many symbols changed, how many callers, how many
  endpoints and crons are hit.
- Under each changed symbol see its callers as `file:line`, and under them the
  endpoints and crons that depend on that symbol.
- Click `file:line` → land on that line in GitHub.
- See a clear state when there are no callers at all, or when the repo index is
  incomplete.
- Ask Claude Code for the PR impact map → get the same answer as the browser.

## Already in the starter

- `repoIntel.getBlastRadius(repoId, changedFiles)` — one call returns the whole
  map. `BlastResult`: `changedSymbols`, `callers` (flat list: `file, symbol,
  viaSymbol, line, rank`), `impactedEndpoints` ("METHOD /path"), `factsByFile`
  (endpoints & crons per caller file) and `degraded` + `reason`.
- Facade already drops the file where the symbol is declared, resolves the
  caller function name and pulls endpoints. Limits `MAX_CALLERS_PER_SYMBOL`
  (20) and `BFS_DEPTH` (2) live in `server/src/modules/repo-intel/constants.ts`.
  Do not recompute — show.
- Facade never throws. No data → empty arrays + `degraded: true` with reason
  `flag_off | index_failed | index_partial | repo_too_large | no_data`.
- Contract: Zod `BlastRadius` in `server/src/vendor/shared/contracts/brief.ts`
  (identical copy in `client/src/vendor/shared/contracts/brief.ts`):
  `changed_symbols[]`, `downstream[{ symbol, callers[{ name, file, line }],
  endpoints_affected[], crons_affected[] }]`, `summary`.
  `BlastResult` (facade) ≠ `BlastRadius` (contract): facade callers are flat
  with `viaSymbol`; contract groups them under their symbol. That mapping is
  the main server work.
- `githubBlobUrl(repoFullName, sha, file, startLine)` in
  `client/src/lib/github-urls.ts`. Caller files are not in the PR diff, so the
  click goes to GitHub, not the diff.
- Labels in `client/messages/en/blast.json`: `stat.symbols`, `stat.callers`,
  `stat.endpoints`, `stat.crons`, `callerCount`, `noDownstream`, `view.tree`,
  `view.graph`.
- `GET /repos/:id/index-state`, `POST /repos/:id/resync`.
- `devdigest-mcp` has a `get_blast_radius` stub with description and schema —
  wire it to the route.

## Suggested implementation

- Server module `server/src/modules/blast/`, route `GET /pulls/:id/blast`. Take
  the PR's changed files, call `repoIntel.getBlastRadius(repoId, changedFiles)`
  **once**, map to contract `BlastRadius`.
- Mapping: group flat `callers` by `viaSymbol` → `downstream`. Endpoints and
  crons per group come from `factsByFile` over that group's caller files.
  `summary` is a string built from numbers, no model.
- Honest degradation: facade `degraded: true` + reason propagate into the
  response so the UI can show a state instead of an empty map.
- Overview block fed by a new hook. Start with summary + simple list with links;
  collapsible tree and graph optional.
- MCP: replace the stub with a call to the same route `GET /pulls/:id/blast`.
  Return the route's response. `readOnlyHint: true`.
- Build through the L03 pipeline: planner → implementer →
  (architecture-reviewer ∥ plan-verifier). PR description says which subagent
  did what.

## Acceptance criteria

### P1 — blocking

1. Overview tab of a PR has a Blast radius block.
2. Summary on top: changed symbols, callers, endpoints, crons counts.
3. Under each changed symbol: its callers as `file:line`, under them the
   endpoints that depend on the symbol.
4. On a test PR changing a shared helper the map shows ≥2 real callers and ≥1
   HTTP endpoint.
5. Click on `file:line` opens exactly that line on GitHub.
6. No callers → clear text instead of an empty screen. Incomplete index →
   separate badge with the reason.
7. `devdigest-mcp` has a working `get_blast_radius` instead of the stub; in
   Claude Code it returns the same map as the page block (simply calls the
   route).
8. Open PR with implementation description and demo video.

### P2 — non-blocking

1. Logs show reading the ready index, not re-parsing: AST and import graph are
   not rebuilt.
2. Route response passes `BlastRadius` contract validation.
3. Flat `callers` → grouped `downstream` mapping is unit-tested.
4. Main scenario calls no LLM. Optional text summary → exactly one call, and the
   feature works without it.
5. The file declaring a symbol is not among its own callers.
6. Limits (20 callers/symbol, depth 2) come from `constants.ts`, not hard-coded
   in the component.
7. `degraded` and `reason` reach the UI, not lost on the server.
8. `get_blast_radius` follows the lab rules: short "when to call" description,
   clear argument schema, concise response, useful error for an unknown PR,
   `readOnlyHint: true`.
9. PR description says which subagent did what.

### P3 — nice to have

1. Symbols collapse/expand like the tree in the screenshot.
2. Second view — graph, with Tree / Graph toggle (`view.tree`, `view.graph`).
3. "Prior PRs touching these files" block (Zod `PrHistory` in `brief.ts`; data
   must be fetched from GitHub).
4. Crons shown separately from HTTP endpoints.
5. Symbols sorted by rank, most important on top.
6. Next to the incomplete-index badge, a button calling `POST /repos/:id/resync`.
7. UI labels come from `client/messages/en/blast.json`, not hard-coded.

## How to verify (video script)

1. Test PR → Overview → Blast radius → summary: symbols, callers, endpoints,
   crons.
2. Under a changed symbol: callers `file:line` and endpoints under them.
3. Open 1–2 callers in code: they really use the changed function (not its own
   dependencies).
4. Click `file:line` → GitHub opens that line.
5. Show the no-callers state and the incomplete-index state.
6. In Claude Code ask for the impact map of the same PR → matches the block.
7. One sentence: why the map calls no model and doesn't re-parse the repo.

Test PR: changes an exported function imported by ≥2 other files, e.g. from
`server/src/modules/reviews/helpers.ts` or
`client/src/components/diff-viewer/helpers.ts`. Before the run
`GET /repos/:id/index-state` must return `status: full`.
