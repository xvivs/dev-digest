# ADR 0011 — One error surface per failed mutation

**Status:** accepted
**Date:** 2026-09-28

## Context

`client/src/lib/providers.tsx` toasted every mutation error from the
`MutationCache`. Three screens also report the same error themselves:

- `DiffTab.tsx:36-37` raises a second toast with the same message.
- `AddRepoView.tsx:36-37` shows the message inline under the URL field.
- `SettingsApiKeys.tsx:47-48` shows it inline next to the key.

The user sees each failure twice: a toast plus an inline message, or two
identical toasts. The local copies carry context the global handler lacks
("Could not add repository" beside the field it concerns), so deleting them
loses information.

## Decision

1. The `MutationCache` toasts a failed mutation by default.
2. A mutation that reports its own error declares
   `meta: { errorSurface: "local" }`, and the global handler skips it.
3. `meta` is typed through TanStack's `Register` interface in
   `client/src/lib/query-client.ts`:
   `AppMutationMeta = { errorSurface?: "global" | "local" }`. A typo in the
   key or the value fails typecheck.
4. A mutation hook in `lib/hooks` whose consumer may surface locally takes
   `options?: MutationHookOptions` and forwards `options.meta`. The call site
   that owns the inline message opts out, so a second consumer of the same
   hook keeps the global toast.
5. Queries keep their rule: toast on network failure (status 0) and 5xx only.

## Consequences

### What this enables

- One message per failure, and the specific copy stays where it helps.
- `grep -rn errorSurface client/src` lists every exception to the default.
- `createQueryClient` is pure, so a unit test pins the policy
  (`query-client.test.ts`).

### What this costs

- An author who adds a local error message must also add the flag, or the
  user sees two messages again. Review has to catch it; no lint rule does.
- `meta` is a `useMutation` option. `mutate()` cannot set it, so each hook
  that needs the opt-out grows an `options` parameter.

### What this forbids

- A local `notify.error` or inline error for a mutation without
  `errorSurface: "local"`.
- Silencing the global handler for a mutation that shows nothing itself.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Global only: delete the local messages | One rule, least code | Loses field-level context in AddRepo and API keys |
| **Local wins through `meta` (chosen)** | Keeps specific copy; exceptions are greppable | Each exception must remember the flag |
| Local only: drop the `MutationCache` toast | Full control per screen | A forgotten handler fails silently |
