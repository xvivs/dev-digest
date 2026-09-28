/* PR list error boundary — a render error on /repos/:repoId/pulls (and, until
   the PR-detail segment gets its own, below it) shows RouteError inside the
   app shell, so the sidebar stays usable. If AppShell itself is what threw,
   this boundary rethrows and the root app/error.tsx takes over. */
"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";
import { AppShell } from "@/components/app-shell";

export default function PullsError(props: RouteErrorProps) {
  return (
    <AppShell>
      <RouteError {...props} />
    </AppShell>
  );
}
