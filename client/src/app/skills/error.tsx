/* Segment error boundary for /skills and /skills/:id. Keeps the app chrome so
   a crash in the list or the editor leaves navigation usable. If AppShell
   itself throws, this boundary re-throws and the root app/error.tsx takes over. */
"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RouteError, type RouteErrorProps } from "@/components/route-error";
import { SKILLS_HREF } from "./constants";

export default function SkillsError(props: RouteErrorProps) {
  const t = useTranslations("skills");
  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: SKILLS_HREF }]}>
      <RouteError {...props} />
    </AppShell>
  );
}
