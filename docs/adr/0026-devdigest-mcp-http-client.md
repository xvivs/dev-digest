# ADR 0026 — devdigest-mcp is a standalone HTTP client on SDK v1; annotations are not the boundary

**Status:** proposed
**Date:** 2026-10-01
**Amends:** ADR 0001, ADR 0007
**Relates to:** ADR 0001, ADR 0007, ADR 0020; [specs/07-devdigest-mcp.md](../../specs/07-devdigest-mcp.md)

## Context

L04 adds an MCP server so Claude Code can run DevDigest reviews and read findings. Runs must live in the API process: `runBus` is a module-level singleton and boot reaping assumes a single API instance per database (ADR 0020). The vendored shared contracts are zod 3. MCP tool annotations (`readOnlyHint` and the rest) are hints that clients may ignore.

## Decision

1. **A standalone `mcp/` package that talks to the API over HTTP only.** No DB and no server-module imports. Shared contracts are reused by nested `.pick()` through tsconfig paths, as reviewer-core does. `mcp/` becomes the second consumer of the `server/src/vendor/shared` copy (ADR 0001 names only reviewer-core).
   - **1a.** mcp parses every API response with picked, non-strict schemas in all environments. ADR 0007's dev-only parse rule is scoped to the client `apiFetch`. Its argument against parsing everywhere was a strict parse that breaks on additive changes, and picked schemas do not. A deliberate exception to ADR 0007's "no loosened schemas" clause: `category` is relaxed to `z.string()` because it is a pass-through field. This is not a drift fix. The enums the tools branch on (`severity`, `verdict`, statuses) stay strict.
2. **`@modelcontextprotocol/sdk` 1.31.0 (v1), pinned exactly.** v2 requires zod ^4.2.
3. **The permission boundary is code.** One `DevDigestApi` class (`mcp/src/api/client.ts`) with eight explicit method+path pairs and no generic request helper. Annotations only describe it.

## Consequences

- **Enables:** the MCP needs no migration or seed of its own, and the API process stays the single writer.
- **Costs:** an extra hop and an API that must be running. PR resolution goes through `GET /repos/:id/pulls`, which syncs GitHub and can schedule auto-brief jobs, so PR-resolving read tools are annotated open-world. Hermetic tests cannot catch route drift. A second consumer of the vendored contracts. A v2 migration later, triggered by the shared contracts moving to zod 4.
- **Forbids:** a generic request helper reachable from tools; tool-side DB access; adding an endpoint without a new method and a test.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| MCP inside the server process (Fastify plugin + HTTP transport) | no extra hop | ties the MCP lifecycle to the API; stdio impossible; needs server changes (out of scope for this lab) |
| MCP with direct DB access | fast reads | a second process would start runs outside the `runBus` owner (ADR 0020) |
| **Standalone HTTP client (chosen)** | isolated, no server change | API drift is caught only at runtime |
| SDK v2 | newer API | zod ^4.2 conflicts with the zod 3 contracts |
