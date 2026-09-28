"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import type {
  FindingRecord,
  ReviewRecord,
  RunSummary,
  PrCommit,
  Severity,
  SeverityCounts,
} from "@devdigest/shared";
import { countBySeverity } from "@/components/severity-icons";
import { useCancelRun, useRefreshRunState } from "@/lib/hooks";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { s } from "./styles";

/** Which review the Timeline last pointed at, and with which severity filter.
 *  `n` re-triggers the jump when the same target is clicked twice. */
interface ReviewTarget {
  reviewId: string;
  severity: Severity | null;
  n: number;
}

export interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Severity read off `?severity=` — pre-filters the newest run's findings. */
  initialSeverity?: Severity | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  repoFullName,
  headSha,
  initialSeverity = null,
  onOpenTrace,
  onDelete,
}: FindingsTabProps) {
  const t = useTranslations("prReview");
  // Cancelling refetches active runs + history itself (useCancelRun's onSettled);
  // a settled SSE stream refetches everything a run touches.
  const { mutate: cancelRun, isPending: cancelling } = useCancelRun(prId);
  const refreshRunState = useRefreshRunState(prId);

  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelRun(id));
  }, [liveRunIds, cancelRun]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  // A run row in the Timeline only knows its run_id; everything it needs to
  // render (severity tally, the findings behind the popover) and everything the
  // click has to resolve (run_id → review id) is derived ONCE here. Tallying
  // inside RunHistory's `.map()` would mint a fresh counts object every render
  // and defeat the `React.memo` on `SeverityIcons`.
  const { findingsByRun, countsByRun, reviewIdByRun } = React.useMemo(() => {
    const findings = new Map<string, FindingRecord[]>();
    const counts = new Map<string, SeverityCounts>();
    const reviewIds = new Map<string, string>();
    for (const review of runs) {
      if (!review.run_id) continue;
      // Several review rows can share one run_id (a re-persisted run): last one
      // in `runs` wins. Reviews with no run_id have no timeline tile at all.
      findings.set(review.run_id, review.findings);
      counts.set(review.run_id, countBySeverity(review.findings));
      reviewIds.set(review.run_id, review.id);
    }
    return { findingsByRun: findings, countsByRun: counts, reviewIdByRun: reviewIds };
  }, [runs]);

  // run_id → the server's blocker count, so the accordion shows the same number
  // as the timeline row (one definition on screen).
  const blockersByRun = React.useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of prRuns ?? []) m.set(r.run_id, r.blockers);
    return m;
  }, [prRuns]);

  // Timeline → Review-runs navigation: clicking an agent name (or a severity
  // chip) in the timeline opens + scrolls to that run's accordion below and,
  // for a chip, pre-filters it. The nonce re-triggers both even when the same
  // run/severity is clicked twice.
  const [target, setTarget] = React.useState<ReviewTarget | null>(null);
  // `?severity=` applies to the newest run — the one rendered `defaultOpen`.
  // Reviews arrive asynchronously, so seed on the render they first appear on
  // (state adjusted during render, not in an effect: an effect would paint one
  // unfiltered frame first). Seeding happens at most once per mount.
  const [seeded, setSeeded] = React.useState(false);
  const firstReviewId = runs[0]?.id;
  if (!seeded && firstReviewId) {
    setSeeded(true);
    if (initialSeverity) setTarget({ reviewId: firstReviewId, severity: initialSeverity, n: 1 });
  }

  const handleGoToReview = useCallback(
    (runId: string, severity?: Severity) => {
      const reviewId = reviewIdByRun.get(runId);
      if (!reviewId) return;
      setTarget((p) => ({ reviewId, severity: severity ?? null, n: (p?.n ?? 0) + 1 }));
    },
    [reviewIdByRun],
  );

  const live = liveRunIds.length > 0;

  return (
    <section>
      {live && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button kind="danger" size="sm" icon="X" loading={cancelling} onClick={handleCancelAll}>
                  {t("findingsTab.cancel")}
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  {t("findingsTab.openTrace")}
                </Button>
              </div>
            }
          >
            {t("findingsTab.liveReview")}
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={refreshRunState} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={s.spinner} />
          <span style={s.reviewInProgressText}>{t("findingsTab.inProgressTitle")}</span>
          <span style={s.reviewInProgressSub}>{t("findingsTab.inProgressBody")}</span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={s.shieldIcon} />
          <span style={s.lethalTrifectaTitle}>{t("findingsTab.lethalTrifecta")}</span>
          <Badge color="var(--crit)" bg="transparent">
            {t("findingsTab.lethalCount", { count: lethalTrifecta.length })}
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel icon="Activity" right={<span style={s.sectionHint}>{t("findingsTab.timelineHint")}</span>}>
            {t("findingsTab.timeline")}
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            countsByRun={countsByRun}
            onOpenTrace={onOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={onDelete}
          />
        </div>
      )}

      <SectionLabel icon="AlertOctagon" right={<span style={s.sectionHint}>{t("findingsTab.reviewRunsHint")}</span>}>
        {t("findingsTab.reviewRuns")}
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || live ? null : (
          <EmptyState icon="Sparkles" title={t("findingsTab.emptyTitle")} body={t("findingsTab.emptyBody")} />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
            runBlockers={review.run_id ? blockersByRun.get(review.run_id) : null}
            targetReviewId={target?.reviewId ?? null}
            targetSeverity={target?.severity ?? null}
            targetNonce={target?.n ?? 0}
          />
        ))
      )}
    </section>
  );
}
