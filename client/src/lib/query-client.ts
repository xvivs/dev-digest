/* query-client.ts — the app's QueryClient factory and its global error policy.
   No hooks or JSX, so the policy is unit-testable without mounting providers. */
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError, NETWORK_ERROR_STATUS } from "./api";
import { notify } from "./toast";

/**
 * Who reports a failed mutation (docs/adr/0011-mutation-error-surface.md):
 * - "global" (default): the MutationCache toasts `error.message`.
 * - "local": the call site shows its own error (inline field, specific toast);
 *   the global handler stays silent so the user never sees it twice.
 */
export type MutationErrorSurface = "global" | "local";

export interface AppMutationMeta extends Record<string, unknown> {
  errorSurface?: MutationErrorSurface;
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: AppMutationMeta;
  }
}

/** Options a mutation hook in `lib/hooks` forwards to `useMutation`. */
export interface MutationHookOptions {
  meta?: AppMutationMeta;
}

/** Queries toast only on these; expected 4xx (a 404 "no tour yet") stay inline. */
const SERVER_ERROR_MIN_STATUS = 500;
const QUERY_STALE_TIME_MS = 30_000;

function errorMessage(e: unknown, fallback: () => string): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback();
}

/**
 * @param fallbackMessage copy for an error that carries no message of its own.
 *   A function so the caller can read the current translation lazily.
 */
export function createQueryClient(fallbackMessage: () => string): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: false,
      },
    },
    queryCache: new QueryCache({
      onError: (err) => {
        const status = err instanceof ApiError ? err.status : SERVER_ERROR_MIN_STATUS;
        if (status === NETWORK_ERROR_STATUS || status >= SERVER_ERROR_MIN_STATUS) {
          notify.error(errorMessage(err, fallbackMessage));
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.meta?.errorSurface === "local") return;
        notify.error(errorMessage(err, fallbackMessage));
      },
    }),
  });
}
