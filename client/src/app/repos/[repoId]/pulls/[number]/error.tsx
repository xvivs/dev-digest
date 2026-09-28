/* Segment error boundary for one PR. A render error on this screen (trace
   drawer, diff viewer, SSE status) replaces only the page body; the AppShell
   chrome stays, so the user can still navigate away. A boundary never catches
   its own render, so if the shell itself throws here the error bubbles up to
   app/error.tsx, which renders RouteError without a shell. */
"use client";

import { AppShell } from "@/components/app-shell";
import { RouteError, type RouteErrorProps } from "@/components/route-error";

export default function PrDetailError(props: RouteErrorProps) {
  return (
    <AppShell>
      <RouteError {...props} />
    </AppShell>
  );
}
