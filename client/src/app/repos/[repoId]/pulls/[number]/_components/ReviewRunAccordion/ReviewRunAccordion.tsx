/* ReviewRunAccordion — one collapsible review RUN (a single agent's pass over
   the PR). Header shows agent + verdict + counts + score + when it ran; the
   body holds that run's VerdictBanner summary and its own FindingsPanel. A PR
   can have many runs (different agents / re-runs over time) — each is separate
   and collapsible so older runs don't bury the latest. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Disclosure, DisclosureChevron, RowAction } from "@devdigest/ui";
import type { ReviewRecord, Severity } from "@devdigest/shared";
import { useDeleteReview } from "@/lib/hooks";
import { countBlockers } from "@/lib/blockers";
import { LocalTime } from "@/components/local-time";
import { FindingsPanel } from "../FindingsPanel";
import { VerdictBanner, VERDICT_META } from "../VerdictBanner";
import { s } from "./styles";

export interface ReviewRunAccordionProps {
  review: ReviewRecord;
  prId: string;
  defaultOpen?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** The server's blocker count for this review's run (`RunSummary.blockers`),
   *  when a run row is at hand. Without one (a review with no run, or the run
   *  history not loaded yet) the count falls back to `countBlockers`, which
   *  applies the same rule to the findings. */
  runBlockers?: number | null;
  /** When this matches review.id, the accordion opens and scrolls into view
   *  (driven from the Timeline: clicking an agent name navigates here).
   *  Keyed on the REVIEW id, not run_id: reviews with a null run_id exist on a
   *  real database and a run_id gate would never fire for them. */
  targetReviewId?: string | null;
  /** Severity the Timeline asked for — handed straight to the FindingsPanel. */
  targetSeverity?: Severity | null;
  targetNonce?: number;
}

export function ReviewRunAccordion({
  review,
  prId,
  defaultOpen = false,
  repoFullName,
  headSha,
  runBlockers = null,
  targetReviewId = null,
  targetSeverity = null,
  targetNonce = 0,
}: ReviewRunAccordionProps) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(defaultOpen);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const isTarget = targetReviewId != null && review.id === targetReviewId;
  React.useEffect(() => {
    if (isTarget) {
      setOpen(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isTarget, targetNonce]);
  const del = useDeleteReview(prId);
  const findings = review.findings;
  const blockers = runBlockers ?? countBlockers(findings);
  const verdictMeta = review.verdict ? VERDICT_META[review.verdict] : null;
  const agentName = review.agent_name ?? t("accordion.agentFallback");

  const onDelete = () => {
    if (window.confirm(t("accordion.confirmDelete", { agent: agentName }))) {
      del.mutate(review.id);
    }
  };

  return (
    <div ref={rootRef} id={review.run_id ? `review-run-${review.run_id}` : undefined} style={s.card}>
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        headerStyle={s.header}
        header={(isOpen) => (
          <>
            <Icon.Cpu size={15} style={s.cpuIcon} />
            <span style={s.agentName}>{agentName}</span>
            {verdictMeta && (
              <Badge color={verdictMeta.c} bg="transparent">
                {t(`verdict.badge.${verdictMeta.labelKey}`)}
              </Badge>
            )}
            <span style={s.counts}>
              {t("accordion.findingsCount", { count: findings.length })}
              {blockers > 0 ? t("accordion.blockers", { count: blockers }) : ""}
            </span>
            <span style={s.spacer} />
            {review.score != null && (
              <Badge mono color="var(--text-secondary)">
                {review.score}
              </Badge>
            )}
            <span className="mono" style={s.when}>
              <LocalTime iso={review.created_at} />
            </span>
            <DisclosureChevron open={isOpen} />
          </>
        )}
        actions={
          <RowAction
            icon="Trash"
            label={t("accordion.delete")}
            tone="danger"
            size={14}
            busy={del.isPending}
            onClick={onDelete}
          />
        }
      >
        <div style={s.body}>
          {review.verdict && (
            <div style={s.bannerWrap}>
              <VerdictBanner
                verdict={review.verdict}
                summary={review.summary}
                score={review.score}
                findingsCount={findings.length}
                blockers={blockers}
                agentName={review.agent_name}
              />
            </div>
          )}
          {/* Straight through to the panel — no copy of the target in this
              component's state. Scoped to the targeted run so clicking a
              severity on one timeline tile doesn't silently filter every other
              open accordion ("…findings from THIS run"). */}
          <FindingsPanel
            findings={findings}
            prId={prId}
            repoFullName={repoFullName}
            headSha={headSha}
            targetSeverity={isTarget ? targetSeverity : null}
            targetNonce={isTarget ? targetNonce : 0}
          />
        </div>
      </Disclosure>
    </div>
  );
}
