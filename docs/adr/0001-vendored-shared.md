# ADR 0001 — `@devdigest/shared` is vendored per package

**Status:** accepted, with a known and currently unmanaged cost
**Date:** 2026-09-19

## Context

DevDigest is four standalone packages — `server/`, `client/`, `reviewer-core/`,
`e2e/` — each with its own `package.json` and lockfile. There is no root
`package.json` and no `pnpm-workspace.yaml`. Cross-package code resolves through
tsconfig path aliases to TypeScript **source**, not to published or built
artifacts.

The contract layer `@devdigest/shared` (Zod schemas plus inferred types) is used
by all of them. One schema does three jobs: Fastify request validation, response
serialization, and the client's types. It is the strongest structural idea in the
codebase, and it only works if there is one definition.

A workspace package would have been the conventional home for it. The starter
deliberately avoids a workspace so each package stays independently installable
and runnable — a course participant can open one folder and work.

That leaves the question of where the shared contracts physically live.

## Decision

Vendor `@devdigest/shared` into each consumer as a source copy, aliased in that
package's `tsconfig.json`:

```
server/src/vendor/shared/   ←  "@devdigest/shared": ["./src/vendor/shared/index.ts"]
client/src/vendor/shared/   ←  "@devdigest/shared": ["./src/vendor/shared/index.ts"]
```

`reviewer-core` does not carry a copy; it is itself consumed as source by the
server and resolves the alias through the server's tsconfig.

There is **no sync script**. Keeping the copies aligned is a manual step.

## Consequences

### What this enables

- Every package installs and type-checks on its own, with no build step and no
  workspace tooling.
- Contract edits are immediately visible to the consumer — no publish, no rebuild.
- A participant can clone, `pnpm install` in one folder, and work.

### What this costs

**The copies have already diverged.** As of this ADR, `diff -rq` reports five
differing files:

| File | Divergence |
|---|---|
| `adapters.ts` | client's `LLMProvider.id` lacks `'openrouter'`; no `sessionId`, no `CommitFilesPayload` |
| `contracts/eval-ci.ts` | client lacks `AgentManifest` |
| `contracts/knowledge.ts` | client lacks `AgentVersionConfig` |
| `contracts/productionize.ts` | client's `PluginAgent.provider` lacks `'openrouter'` |
| `contracts/trace.ts` | comment drift only |

The divergence is **currently inert**. Everything that differs belongs to L06/L08
contracts (the CI runner and plugin export) that the client does not import — the
main `Provider` enum, which the agent editor actually uses, is identical on both
sides and does include `openrouter`. This is luck, not design: nothing detects
the drift, and nothing prevents the next edit from landing in a type the client
does exercise.

**Duplicate zod module instances.** Because the contracts are duplicated and each
package resolves its own `zod`, `instanceof z.ZodError` can be false for a genuine
`ZodError`. The server's error handler therefore also matches by shape
(`name === 'ZodError'` plus an `issues`/`errors` array); without that, a real
validation failure would return 500 instead of 422. See
`server/docs/request-lifecycle.md`.

**"Single source of truth" is now aspirational.** The barrel's own header still
claims it. Treat that as intent, not as a description of the current state.

### What this forbids

- Editing one copy of a contract. Server and client change together, in the same
  commit, or not at all.
- Treating `*/src/vendor/**` as ordinary source. It is listed under "Do not touch"
  in `CLAUDE.md` for this reason.
- Assuming a type present on one side exists on the other. Check before relying
  on it.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| **pnpm workspace + a real `@devdigest/shared` package** | The correct long-term fix: one physical copy, drift impossible. Rejected because it makes every package depend on workspace tooling and breaks the "open one folder and work" property the starter is built around. |
| **Symlink the copies** | Removes drift with almost no tooling, but symlinks behave inconsistently across Windows, Docker builds and some bundlers — and the starter must work everywhere. |
| **Generate copies from one origin via a sync script** | Keeps package independence and makes drift detectable in CI. The cheapest real improvement; not done yet. This is the recommended next step. |
| **Accept drift, document it** | What we do today. Acceptable only while the divergence stays in unused contracts. |

## Revisit when

- A diverged type reaches code the client actually runs, **or**
- the same contract has to be edited twice in a week, **or**
- the repo gains a workspace for another reason.

At that point, add the sync script and a CI check first; move to a workspace
package only if the starter's independence constraint is dropped.
