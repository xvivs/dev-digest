/* PrDetailContent — everything on the PR screen below the AppShell chrome.
   Reads the URL (?tab, ?trace, ?severity), so it renders inside the view's
   local <Suspense>. Server state comes from lib/hooks; this component owns no
   query keys and invalidates nothing itself. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { usePullDetail, usePulls, usePrReviews, usePrActiveRuns, usePrRuns, useDeleteRun } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import { PrDetailHeader } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader";
import { OverviewTab } from "@/app/repos/[repoId]/pulls/[number]/_components/OverviewTab";
import { FindingsTab } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingsTab";
import { DiffTab } from "@/app/repos/[repoId]/pulls/[number]/_components/DiffTab";
import { RunTraceDrawer } from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { PrDetailSkeleton } from "../PrDetailSkeleton";
import { CONDENSED_BAR_HEIGHT, MOBILE_QUERY, RUNS_TAB, type PrTab } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { parseSeverity, parseTab, prDetailHref } from "../../helpers";
import { s } from "../../styles";
import { useMediaQuery, useStickyOffset } from "./hooks";

export interface PrDetailContentProps {
  repoId: string;
  number: string;
  /** Real "owner/repo" (null until the repo loads) — for github.com deep links. */
  repoFullName: string | null;
}

export function PrDetailContent({ repoId, number, repoFullName }: PrDetailContentProps) {
  const t = useTranslations("prReview");
  const search = useSearchParams();
  const router = useRouter();

  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);
  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews } = usePrReviews(prId);
  const mobile = useMediaQuery(MOBILE_QUERY);
  // Desktop: measured header height. Mobile: the condensed bar's fixed height.
  const { setSource: setHeaderRef, setTarget: setBodyRef } = useStickyOffset(
    mobile ? CONDENSED_BAR_HEIGHT : undefined,
  );

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const { mutate: deleteRun } = useDeleteRun(prId);
  const liveRunIds = React.useMemo(() => (activeRuns ?? []).map((r) => r.run_id), [activeRuns]);

  const tab: PrTab = parseTab(search.get("tab"));
  const traceRunId = search.get("trace");
  // ?severity= pre-filters the newest run's findings (the link a severity chip
  // elsewhere in the app points at). Anything outside the enum is dropped
  // rather than passed down as a filter nothing can match.
  const initialSeverity = parseSeverity(search.get("severity"));

  const setParam = (key: string, val: string | null) =>
    router.replace(prDetailHref(repoId, number, search.toString(), key, val));
  const setTab = (next: PrTab) => setParam("tab", next);
  const openRunsTab = () => setParam("tab", RUNS_TAB);
  const openTrace = (id: string) => setParam("trace", id);
  const closeTrace = () => setParam("trace", null);
  const confirmDeleteRun = (id: string) => {
    if (window.confirm(t("detail.confirmDeleteRun"))) deleteRun(id);
  };

  // Reviews come newest-first; each is its own run (grouped into accordions).
  // Memoised so the lookup maps FindingsTab derives from it stay referentially
  // stable across renders (they feed memoised children in the timeline).
  const runs = React.useMemo(() => reviews ?? [], [reviews]);
  const allFindings: FindingRecord[] = React.useMemo(() => runs.flatMap((r) => r.findings), [runs]);
  const lethalTrifecta = React.useMemo(
    () => allFindings.filter((f) => f.kind === "lethal_trifecta"),
    [allFindings],
  );

  if (isLoading) return <PrDetailSkeleton />;

  if (isError || !pr) {
    return (
      <ErrorState
        fullScreen
        title={t("detail.loadErrorTitle")}
        body={error instanceof ApiError ? error.message : t("detail.loadErrorBody", { number })}
        onRetry={() => refetch()}
      />
    );
  }

  const traceReview = traceRunId ? runs.find((r) => r.run_id === traceRunId) : undefined;

  return (
    <>
      <PrDetailHeader
        ref={setHeaderRef}
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={allFindings.length}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={openRunsTab}
        mobile={mobile}
      />

      <div ref={setBodyRef} style={s.body}>
        {tab === "overview" && prId && <OverviewTab prId={prId} />}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={liveRunIds.length > 0}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            initialSeverity={initialSeverity}
            onOpenTrace={openTrace}
            onDelete={confirmDeleteRun}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            headSha={pr.head_sha}
            files={pr.files}
            repoFullName={repoFullName}
            canComment={pr.status === "open"}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={traceReview?.findings ?? []}
          agentName={traceReview?.agent_name ?? null}
          onClose={closeTrace}
        />
      )}
    </>
  );
}
