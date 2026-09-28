/* Settings segment boundary — a render error in any settings section shows
   RouteError inside the app chrome, so the sidebar stays usable. A crash in
   AppShell itself bubbles on to app/error.tsx. */
"use client";

import { AppShell } from "@/components/app-shell";
import { RouteError, type RouteErrorProps } from "@/components/route-error";

export default function SettingsError(props: RouteErrorProps) {
  return (
    <AppShell>
      <RouteError {...props} />
    </AppShell>
  );
}
