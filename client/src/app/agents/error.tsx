/* Segment error boundary for /agents and /agents/:id. Keeps the app chrome so
   a crash in the list or the editor leaves navigation usable. If AppShell
   itself throws, this boundary re-throws and the root app/error.tsx takes over. */
"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RouteError, type RouteErrorProps } from "@/components/route-error";
import { AGENTS_HREF } from "./constants";

export default function AgentsError(props: RouteErrorProps) {
  const t = useTranslations("agents");
  return (
    <AppShell crumb={[{ label: t("list.breadcrumbLab") }, { label: t("list.breadcrumb"), href: AGENTS_HREF }]}>
      <RouteError {...props} />
    </AppShell>
  );
}
