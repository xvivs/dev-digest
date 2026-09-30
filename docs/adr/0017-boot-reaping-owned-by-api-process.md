# ADR 0017 — Boot-time reaping belongs to the API process, not `buildApp`

**Status:** accepted
**Date:** 2026-09-30

## Context

A run's job lives in the process that started it. If that process dies, the row stays
`running` forever, so the server reaps orphans on boot: `reapStaleRunningRuns` for review
runs and `reapStaleScans` for conventions scans. Both ran inside every `buildApp()` call.

`server/test/routes-smoke.test.ts` is a unit test with no DB by intent. It imports
`dotenv/config` through `server/src/platform/config.ts`, so it picked up the dev database
URL from `.env`, and it builds the app four times. Each build reaped. Every unit run
flipped the live API's in-flight runs to `failed` with `error = null`, and the executor
then overwrote them with `done`. The UI showed a transient error and a 404 on the trace.

We found it with `log_statement = 'mod'` in Postgres, which showed the `UPDATE` statements
arriving from the test process. `AGENTS.md` already warned that reaping assumes a single
API instance per database. An in-process app sharing the dev DB is a second instance.

## Decision

1. **Opt-in flag.** `BuildAppOptions.reapOnBoot` (`server/src/app.ts`) defaults to `false`.
   `buildApp` reaps runs and scans only when it is `true`.
2. **One owner.** `server/src/server.ts`, the real API process, passes `reapOnBoot: true`.
   Tests and scripts get no reaping unless they ask for it.
3. **Test coverage.** `server/test/boot-reap.it.test.ts` checks that an app built without
   the flag leaves `running` rows alone and that an app built with it reaps them.

## Consequences

### What this enables

- Unit runs and scripts can build an app against the dev DB without touching live runs.
- A second in-process app on the same database leaves the API's in-flight runs alone.
- The single-instance assumption is visible at one call site, `server.ts`.

### What this costs

- A new entrypoint that should reap must remember to pass `reapOnBoot: true`. Forgetting
  it leaves orphaned `running` rows until the next API boot.
- The single-API-instance assumption stays. Replicas would still reap each other's runs.
- Tests that cover reaping must set the flag explicitly.

### What this forbids

- Reaping inside `buildApp` without `reapOnBoot`.
- Passing `reapOnBoot: true` from tests, scripts or any process that is not the sole API
  instance for its database.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Keep reaping in `buildApp`, isolate tests from `.env` | No API change; tests get a clean DB | Fixes one caller. Any script or future test that loads `.env` brings the bug back |
| Heartbeat or lease per run instead of boot reaping | Correct with several instances; no false `failed` | Schema change, a writer loop and a timeout to tune; more than a single-instance app needs |
| **Reaping belongs to the process, opt-in `reapOnBoot` (chosen)** | Small change; safe default for every caller; ownership sits in `server.ts` | Relies on callers to opt in; single-instance assumption remains |
