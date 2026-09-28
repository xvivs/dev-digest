/* render.tsx — shared RTL render for component tests: next-intl messages +
   a fresh React Query client per call. Use it instead of hand-rolling the
   provider wrapper in each test file. */
import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Message namespaces keyed by name, e.g. `{ prReview: prReviewMessages }`. */
  namespaces?: Record<string, AbstractIntlMessages>;
  /** Supply your own client to pre-seed data or spy on invalidation. */
  queryClient?: QueryClient;
  /** Defaults to "en". */
  locale?: string;
  /** Defaults to "UTC" so date output is the same on every machine. */
  timeZone?: string;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

/** A client for tests: no retries (a failing query fails at once), no caching between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    namespaces = {},
    queryClient = createTestQueryClient(),
    locale = "en",
    timeZone = "UTC",
    ...options
  }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={namespaces} timeZone={timeZone}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}
