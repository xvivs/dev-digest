# ADR 0010 — A nested route may import its ancestor route's `_components`

**Status:** accepted
**Date:** 2026-09-28

## Context

The `frontend-architecture` skill forbids a route from reaching into "another
route's `_components/`", and the promotion rule moves a component to
`src/components/` once a second route screen renders it. Neither says whether a
nested route counts as "another route".

The 2026-09-28 client audit (ARCH-5, `client/specs/frontend-audit/README.md`)
hit exactly this case. `/agents/[id]` renders the agent list next to the editor
and imports `AgentCard` from `app/agents/_components/`
(`client/src/app/agents/[id]/page.tsx:10`). Read strictly, the rule says
promote `AgentCard` to `src/components/agent-card/`. Read loosely, the import
is fine. Two reviewers can reach opposite verdicts on the same diff, and an
agent picks whichever reading the nearest file shows.

## Decision

1. A route under `app/<a>/<b>/…` MAY import from the `_components/` of any
   ancestor segment (`app/<a>/_components/`), through that component's
   `index.ts`.
2. A route MUST NOT import from a sibling or cousin segment's `_components/`
   (`app/agents/**` importing from `app/repos/**/_components/`). That case
   still triggers the promotion rule.
3. An ancestor never imports from a descendant's `_components/`.
4. `AgentCard` stays in `app/agents/_components/`.

## Consequences

### What this enables

- A detail route reuses its list route's card or row without a premature move
  into `src/components/`, which would advertise it as cross-route chrome.
- The import direction matches the URL tree, so a reviewer checks it by
  reading the two paths.

### What this costs

- A component under `app/<a>/_components/` gains consumers that its folder no
  longer lists next to it. Changing its props needs a grep across the subtree.
- Nothing enforces the rule. The client has no ESLint and no dependency-cruiser
  config. A reviewer or the `frontend-architecture` skill catches violations.

### What this forbids

- Sibling-to-sibling `_components` imports, and descendant-to-ancestor
  imports in the reverse direction.
- Promoting a component to `src/components/` only because a nested route uses
  it.

## Alternatives considered

| Option | Why not |
|---|---|
| **Promote on any second consumer, nested or not** | Consistent with the literal promotion rule, but it moves `AgentCard` into a shared tier that only `/agents/**` uses and invites unrelated screens to depend on it. |
| **Allow any cross-route import through `index.ts`** | Lowest friction, but it couples unrelated screens and makes the promotion rule unenforceable. |
| **Shared route-level `app/agents/_shared/` folder** | A third convention for the same thing. `_components/` at the ancestor already is that folder. |

## Revisit when

- A lint or dependency-cruiser gate lands for the client. Encode rules 1–3 in it.
- A component under an ancestor `_components/` gains a consumer outside that
  subtree. Promote it then.
