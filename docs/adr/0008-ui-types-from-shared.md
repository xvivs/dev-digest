# ADR 0008 — `@devdigest/ui` takes `Severity`/`Category` from `@devdigest/shared`

**Status:** accepted
**Date:** 2026-09-28

## Context

`vendor/ui/primitives/tokens.ts` declared its own `Severity` and `Category`
unions next to the zod-inferred ones in `@devdigest/shared`
(`contracts/findings.ts:11-12,26-27`). The two looked alike but TypeScript
treated them as unrelated, so every hand-off from contract data to a badge
needed a cast (`FindingCard.tsx:75,80`, audit finding TS-5). The value sets also
differ: the UI renders `INFO` (log lines, neutral notices), and no finding ever
carries it. Three local severity orders grew around the gap (ARCH-34), one of
them with `INFO`.

ADR 0003 made `vendor/ui` editable but said nothing about which way the two
vendored packages may depend on each other.

## Decision

- `@devdigest/ui` may import **types** from `@devdigest/shared` (`import type`
  only, so no zod reaches the design-system bundle). Shared never imports UI.
- `Category` is the shared `FindingCategory`, re-exported under the old name.
- `Severity` is a documented superset: `SharedSeverity | "INFO"`. A shared
  severity assigns to it without a cast. Narrowing it to the shared union would
  have removed `INFO` from `SEV`, the Showcase and every log surface.
- `SEV` stays `Record<Severity, …>`, and `tokens.ts` owns the one ordering:
  `SEVERITY_ORDER`, with `SEVERITY_RANK` and `compareSeverity` derived from it.

## Consequences

### What this enables

- The `as Severity` / `as Category` casts at call sites can go.
- A new finding category in the contract fails typecheck in `CAT` until someone
  gives it an icon and label.
- Feature code can drop its three local severity orders for one import.

### What this costs

- The design system now depends on the contracts package. A second consumer of
  `@devdigest/ui` would have to bring `@devdigest/shared` along.
- A new shared severity needs a matching `SEV` entry in the same change, or
  typecheck breaks.

### What this forbids

- Runtime imports from `@devdigest/shared` inside `vendor/ui`.
- Redeclaring a contract union in the design system. Add a UI-only member
  through a named superset, as `INFO` does.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep both unions plus a structural type test that fails on drift | Catches drift but keeps the casts, and the test has to encode the `INFO` exception by hand. |
| Narrow UI `Severity` to the shared three | Drops `INFO` rendering, which live UI surfaces use. |
| Add `INFO` to the shared contract | `vendor/shared` has two copies and a server-side meaning; ADR 0001 rules out a UI-driven contract change. |
