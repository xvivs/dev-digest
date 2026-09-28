/* Root 404 — rendered for unknown URLs and any notFound() call without a closer
   not-found.tsx. Same EmptyState visual language as RepoNotFound, inside the
   shell so navigation stays available. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";

export default function NotFound() {
  const t = useTranslations("common.boundaries.notFound");
  const router = useRouter();
  return (
    <AppShell>
      <PageContainer>
        <EmptyState
          icon="Search"
          title={t("title")}
          body={t("body")}
          cta={t("cta")}
          onCta={() => router.push("/")}
        />
      </PageContainer>
    </AppShell>
  );
}
