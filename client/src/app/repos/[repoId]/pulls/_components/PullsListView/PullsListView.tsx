/* PullsListView — the PR list screen (/repos/:repoId/pulls). Ported from
   screen_dashboard.jsx; fetches GET /repos/:id/pulls (F1). The status filter
   lives in the URL (?status=) so it survives reload; query and sort are view
   state. Reads useSearchParams, so the route renders it inside <Suspense>. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, EmptyState, ErrorState, AutoTriggerStatus } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePulls, useRefreshRepo } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { countNeedsReview, countOpen } from "@/lib/pr-status";
import {
  COLUMN_KEYS,
  DEFAULT_SORT,
  DEFAULT_STATUS_FILTER,
  RIGHT_ALIGNED_COLUMNS,
  SKELETON_ROWS,
  SKELETON_ROW_HEIGHT,
  STATUS_ALL,
} from "../../constants";
import type { SortOrder } from "../../helpers";
import { s } from "../../styles";
import { PRRow } from "../PRRow";
import { FilterBar } from "../FilterBar";
import { filterAndSortPulls } from "./helpers";

export function PullsListView({ repoId }: { repoId: string }) {
  const t = useTranslations("prReview");
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls, isLoading, isError, error, refetch } = usePulls(repoId);
  const refresh = useRefreshRepo();

  const status = search.get("status") ?? DEFAULT_STATUS_FILTER;
  const setStatus = (k: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("status", k); // always explicit so "all" sticks over the needs_review default
    router.replace(`/repos/${repoId}/pulls?${sp.toString()}`);
  };

  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<SortOrder>(DEFAULT_SORT);

  const rows = filterAndSortPulls(pulls, { status, query, sort });
  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: repoName, mono: true }, { label: t("list.breadcrumb") }];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{t("list.title")}</h1>
          <p style={s.pageSubtitle}>
            {pulls
              ? t("list.summary", { open: countOpen(pulls), needsReview: countNeedsReview(pulls) })
              : t("list.loading")}
          </p>
        </div>
        <div style={s.headerActions}>
          <AutoTriggerStatus on={false} />
        </div>
      </div>

      <div style={s.tableCard}>
        <FilterBar
          active={status}
          onActive={setStatus}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          onRefresh={() => refresh.mutate(repoId)}
          refreshing={refresh.isPending}
        />
        <div style={s.headRow}>
          {COLUMN_KEYS.map((key) => (
            <div key={key} style={s.headCell(RIGHT_ALIGNED_COLUMNS.has(key))}>
              {t(`list.columns.${key}`)}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={SKELETON_ROW_HEIGHT} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("list.errorTitle")}
            body={error instanceof ApiError ? error.message : t("list.errorBody")}
            onRetry={() => refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="GitPullRequest"
            title={t("list.emptyTitle")}
            body={
              status === STATUS_ALL
                ? t("list.emptyAllBody")
                : t("list.emptyStatusBody", { status })
            }
          />
        ) : (
          rows.map((pr) => <PRRow key={pr.number} pr={pr} repoId={repoId} />)
        )}
      </div>
    </AppShell>
  );
}
