/* ConventionsView — /repos/:repoId/conventions (SPEC-02-CONV, AC-32..AC-42).
   Owns the screen's state machine (see `resolveScreen`), the tab filter and the
   selection. The selection is stored as a set of ids but only ever READ through
   `effectiveSelection`: what counts is the ids that are accepted right now, so a
   rejected or vanished card can never linger in the payload (AC-39).
   Decisions are optimistic in `useUpdateConvention`; this view just sends them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Tabs } from "@devdigest/ui";
import type { ConventionCategory, ConventionStatus } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import {
  useConventions,
  useExtractConventions,
  useRepoIntelStatus,
  useResyncRepoIntel,
  useUpdateConvention,
} from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { DEFAULT_TAB, TAB_KEYS, type TabKey } from "../../constants";
import {
  acceptedIds,
  effectiveSelection,
  filterByTab,
  tabCounts,
} from "../../helpers";
import { ConventionCard } from "../ConventionCard";
import { ScanHeader } from "../ScanHeader";
import { TransformToSkillModal } from "../TransformToSkillModal";
import { LOCAL_ERRORS, MAX_SELECTED, SKELETON_CARDS, SKELETON_CARD_HEIGHT } from "./constants";
import { emptyTabKind, isIndexBlocked, isIndexed, isNotCloned, isRepoBlockedError, resolveScreen } from "./helpers";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const conventions = useConventions(repoId);
  const resync = useResyncRepoIntel(repoId, LOCAL_ERRORS);
  // After a resync is accepted, poll the index state until it is usable (AC-32).
  const [indexPolling, setIndexPolling] = React.useState(false);
  const indexState = useRepoIntelStatus(repoId, indexPolling);
  const extract = useExtractConventions(repoId, LOCAL_ERRORS);
  const update = useUpdateConvention(repoId);

  const [tab, setTab] = React.useState<TabKey>(DEFAULT_TAB);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = React.useState(false);

  const page = conventions.data;
  const candidates = React.useMemo(() => page?.candidates ?? [], [page]);
  const counts = tabCounts(candidates);
  const visible = filterByTab(candidates, tab);
  const accepted = acceptedIds(candidates);
  const selection = effectiveSelection(selectedIds, accepted);
  const selectedCandidates = candidates.filter((c) => selection.includes(c.id));

  const indexReady = isIndexed(indexState.data?.status);
  React.useEffect(() => {
    if (indexPolling && indexReady) {
      setIndexPolling(false);
      // The 409 that put the page in "not indexed" is stale now: fall through to "never scanned".
      extract.reset();
    }
  }, [indexPolling, indexReady, extract]);

  const repoBlocked = isRepoBlockedError(extract.error);
  const screen = resolveScreen({
    page,
    loading: conventions.isPending && !conventions.isError,
    loadFailed: conventions.isError,
    indexBlocked: repoBlocked || isIndexBlocked(indexState.data?.status) || activeRepo?.clone_path === null,
    indexPending: indexState.isPending,
  });
  const scanning = screen === "scanning" || extract.isPending;
  const repoName = activeRepo?.name ?? t("page.repoFallback");
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  const runAnalysis = () => extract.mutate();
  const indexRepo = () => resync.mutate(undefined, { onSuccess: () => setIndexPolling(true) });
  const notCloned = isNotCloned({
    clonePath: activeRepo?.clone_path,
    extractError: extract.error,
    indexReason: indexState.data?.reason,
  });
  const indexing = resync.isPending || indexPolling;
  const indexError = resync.error
    ? resync.error instanceof ApiError
      ? resync.error.message
      : t("states.notIndexed.errorFallback")
    : null;
  const decide = (id: string, status: ConventionStatus) => update.mutate({ id, patch: { status } });
  const edit = (id: string, next: { rule: string; category: ConventionCategory }) => {
    const current = candidates.find((c) => c.id === id);
    const patch = {
      ...(next.rule !== current?.rule && { rule: next.rule }),
      ...(next.category !== current?.category && { category: next.category }),
    };
    if (Object.keys(patch).length > 0) update.mutate({ id, patch });
  };
  const setSelected = (id: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const visibleAccepted = visible.filter((c) => c.status === "accepted").map((c) => c.id);
  const allVisibleSelected = visibleAccepted.length > 0 && visibleAccepted.every((id) => selection.includes(id));
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleAccepted) {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const canCreate = selection.length > 0 && selection.length <= MAX_SELECTED;

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const tabs = TAB_KEYS.map((key) => ({
    key,
    label: t(`tabs.${key}`),
    count: counts[key],
    countLabel: t("tabs.countLabel", { label: t(`tabs.${key}`), count: counts[key] }),
  }));
  const emptyKind = emptyTabKind(screen, tab);
  const failedScan = screen === "failed" ? page?.last_scan : null;
  const showList = screen === "list" || screen === "allRejected" || (screen === "failed" && candidates.length > 0);
  const extractError =
    extract.error && !repoBlocked ? (extract.error instanceof ApiError ? extract.error.message : t("extract.errorTitle")) : null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <ScanHeader
          repoName={repoName}
          scan={page?.latest_done_scan ?? null}
          onRescan={runAnalysis}
          scanning={scanning}
          rescanDisabled={screen === "loading" || screen === "loadError" || screen === "notIndexed"}
        />

        {extractError && (
          <div role="alert" style={s.errorBox}>
            <div style={s.errorTitle}>{t("extract.errorTitle")}</div>
            {extractError}
          </div>
        )}

        {screen === "loading" && <LoadingCards />}
        {screen === "loadError" && (
          <ErrorState title={t("page.loadError")} body={conventions.error?.message} onRetry={() => conventions.refetch()} />
        )}
        {screen === "scanning" && (
          <>
            <div style={s.section}>
              <EmptyState
                icon="RefreshCw"
                title={t("states.scanning.title")}
                body={t("states.scanning.body")}
              />
            </div>
            <LoadingCards />
          </>
        )}
        {screen === "notIndexed" && (
          <EmptyState
            icon="Database"
            title={t("states.notIndexed.title")}
            body={
              notCloned ? (
                t("states.notIndexed.notCloned")
              ) : (
                <>
                  {t("states.notIndexed.body")}
                  {indexError && (
                    <div role="alert" style={s.inlineError}>
                      <strong>{t("states.notIndexed.errorTitle")}</strong> {indexError}
                    </div>
                  )}
                </>
              )
            }
            cta={notCloned ? undefined : indexing ? t("states.notIndexed.indexing") : t("states.notIndexed.cta")}
            onCta={indexRepo}
            ctaLoading={indexing}
          />
        )}
        {screen === "never" && (
          <EmptyState
            icon="ListChecks"
            title={t("states.neverScanned.title")}
            body={t("states.neverScanned.body")}
            cta={t("states.neverScanned.cta")}
            onCta={runAnalysis}
            ctaLoading={extract.isPending}
          />
        )}
        {screen === "zeroVerified" && (
          <EmptyState
            icon="ListChecks"
            title={t("states.zeroVerified.title")}
            body={t("states.zeroVerified.body", { count: page?.latest_done_scan?.dropped_count ?? 0 })}
            cta={t("page.rescan")}
            onCta={runAnalysis}
            ctaLoading={extract.isPending}
          />
        )}
        {failedScan && (
          <div role="alert" style={s.failedBox}>
            <div style={s.failedText}>
              <div style={s.failedTitle}>{t("states.failed.title")}</div>
              <div style={s.failedBody}>
                {failedScan.error ?? t("states.failed.fallback")}
                {candidates.length > 0 && ` ${t("states.failed.olderNote")}`}
              </div>
            </div>
            <Button kind="secondary" icon="RefreshCw" onClick={runAnalysis} disabled={scanning} loading={extract.isPending}>
              {t("page.retry")}
            </Button>
          </div>
        )}

        {showList && (
          <div style={s.section}>
            <Tabs
              tabs={tabs}
              value={tab}
              onChange={(k) => setTab(k as TabKey)}
              pad="0"
              ariaLabel={t("tabs.label")}
            />
            <div style={s.toolbar}>
              {tab === "accepted" && visibleAccepted.length > 0 && (
                <Button kind="ghost" size="sm" icon={allVisibleSelected ? "X" : "Check"} onClick={toggleAll}>
                  {allVisibleSelected ? t("toolbar.deselectAll") : t("toolbar.selectAll")}
                </Button>
              )}
              <span className="tnum" style={s.selectedCount}>
                {t("toolbar.selectedCount", { selected: selection.length, accepted: accepted.length })}
              </span>
              <span style={s.spacer} />
              <Button
                kind="primary"
                icon="Sparkles"
                disabled={!canCreate}
                title={canCreate ? undefined : t("toolbar.createSkillHint")}
                onClick={() => setCreating(true)}
              >
                {t("toolbar.createSkill")}
              </Button>
            </div>
            <div role="tabpanel" aria-label={t(`tabs.${tab}`)} style={s.cards}>
              {visible.length === 0 && emptyKind && (
                <div style={s.emptyTab}>
                  {emptyKind === "allRejected" ? (
                    <>
                      <strong>{t("states.allRejected.title")}</strong>
                      <div>{t("states.allRejected.body")}</div>
                    </>
                  ) : (
                    t(`states.tabEmpty.${emptyKind}`)
                  )}
                </div>
              )}
              {visible.map((c) => (
                <ConventionCard
                  key={c.id}
                  candidate={c}
                  repoFullName={activeRepo?.full_name ?? null}
                  selectable={tab === "accepted"}
                  selected={selection.includes(c.id)}
                  onSelectedChange={setSelected}
                  onDecide={decide}
                  onEdit={edit}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {creating && (
        <TransformToSkillModal
          repoId={repoId}
          repoName={repoName}
          conventions={selectedCandidates}
          onClose={() => setCreating(false)}
          onCreated={() => setSelectedIds(new Set())}
        />
      )}
    </AppShell>
  );
}

function LoadingCards() {
  return (
    <div style={s.skeletons} aria-busy="true">
      {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
        <Skeleton key={i} height={SKELETON_CARD_HEIGHT} />
      ))}
    </div>
  );
}
