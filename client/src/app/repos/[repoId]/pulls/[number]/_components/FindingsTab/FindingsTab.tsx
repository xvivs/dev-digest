"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { countBySeverity } from "@/components/severity-icons";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { s } from "./styles";
import type {
  FindingRecord,
  ReviewRecord,
  RunSummary,
  PrCommit,
  Severity,
  SeverityCounts,
} from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

/** Which review the Timeline last pointed at, and with which severity filter.
 *  `n` re-triggers the jump when the same target is clicked twice. */
interface ReviewTarget {
  reviewId: string;
  severity: Severity | null;
  n: number;
}

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Severity read off `?severity=` — pre-filters the newest run's findings. */
  initialSeverity?: Severity | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  initialSeverity = null,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

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

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            countsByRun={countsByRun}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
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
            targetReviewId={target?.reviewId ?? null}
            targetSeverity={target?.severity ?? null}
            targetNonce={target?.n ?? 0}
          />
        ))
      )}
    </section>
  );
}
