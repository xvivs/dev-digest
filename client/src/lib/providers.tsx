/* providers.tsx — client provider stack: React Query + Theme + active Repo. */
"use client";

import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ThemeProvider } from "./theme";
import { RepoProvider } from "./repo-context";
import { ToastProvider } from "./toast";
import { createQueryClient } from "./query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  // The QueryClient outlives renders; the ref lets its error handlers read the
  // current translator instead of the one captured on first render.
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);
  // Global error surfacing lives in createQueryClient: mutations toast unless
  // they opt out with `meta: { errorSurface: "local" }`; queries toast only on
  // network/5xx.
  const [qc] = React.useState(() => createQueryClient(() => tRef.current("errors.generic")));
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <RepoProvider>{children}</RepoProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
