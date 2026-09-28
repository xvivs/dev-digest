/* PrDetailView — /repos/:repoId/pulls/:number. The AppShell chrome and the
   stale-repo guard; the screen itself (header, tabs, trace drawer) is
   PrDetailContent, which reads the URL and so renders inside a local
   <Suspense> with a skeleton instead of the root's empty fallback. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { PrDetailContent } from "./_components/PrDetailContent";
import { PrDetailSkeleton } from "./_components/PrDetailSkeleton";

export interface PrDetailViewProps {
  repoId: string;
  number: string;
}

export function PrDetailView({ repoId, number }: PrDetailViewProps) {
  const t = useTranslations("prReview");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoFullName = activeRepo?.full_name ?? null;

  const crumb = [
    { label: repoFullName ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("list.breadcrumb"), href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  return (
    <AppShell crumb={crumb}>
      {/* Stale/unknown :repoId → friendly empty state instead of a 404 error. */}
      {repoNotFound ? (
        <RepoNotFound />
      ) : (
        <React.Suspense fallback={<PrDetailSkeleton />}>
          <PrDetailContent repoId={repoId} number={number} repoFullName={repoFullName} />
        </React.Suspense>
      )}
    </AppShell>
  );
}
