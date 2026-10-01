"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { usePrReviews, usePrRuns } from "@/lib/hooks";
import { RunCostValue } from "@/components/run-cost-value";
import { VerdictBanner } from "@/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner";
import { formatTokenArrow, formatTokenPair, selectLatestBrief } from "../../helpers";
import { ICON_SIZE, SKELETON_HEIGHT } from "../../constants";
import { s as shared } from "../../styles";
import { s } from "./styles";

/**
 * The newest finished review as a verdict banner with its cost/tokens aside.
 * Reads the same query keys as PrDetailContent (usePrRuns / usePrReviews), so
 * no extra request; owns its own loading and error states.
 */
export function BriefSection({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const runs = usePrRuns(prId);
  const reviews = usePrReviews(prId);

  const brief = runs.data && reviews.data ? selectLatestBrief(runs.data, reviews.data) : null;

  const isError = runs.isError || reviews.isError;
  const retry = () => {
    if (runs.isError) runs.refetch();
    if (reviews.isError) reviews.refetch();
  };

  // Every hook is above this line: the early return below must stay last.
  if (!isError && runs.isSuccess && runs.data.length === 0) return null;

  let body: React.ReactNode;
  if (isError) {
    body = <ErrorState title={t("error")} onRetry={retry} />;
  } else if (runs.isLoading || reviews.isLoading) {
    body = <Skeleton height={SKELETON_HEIGHT.brief} />;
  } else if (!brief) {
    body = (
      <div style={s.briefEmpty}>
        <Icon.Sparkles size={ICON_SIZE.inline} aria-hidden="true" />
        <span style={s.briefEmptyTitle}>{t("noRun")}</span>
        <span style={shared.muted}>{t("unavailableHint")}</span>
      </div>
    );
  } else {
    const { run, review, verdict, newerRun } = brief;
    const tokens = formatTokenPair(run.tokens_in, run.tokens_out);
    const tokenArrow = formatTokenArrow(run.tokens_in, run.tokens_out);
    body = (
      <>
        {newerRun && (
          <div style={shared.notice} role="status">
            <Icon.Info size={ICON_SIZE.section} aria-hidden="true" />
            <span>{t(`newerRun.${newerRun}`)}</span>
          </div>
        )}
        <VerdictBanner
          verdict={verdict}
          summary={review.summary}
          score={review.score}
          findingsCount={review.findings.length}
          blockers={run.blockers ?? 0}
          agentName={review.agent_name}
          aside={
            <span style={s.cost} title={tokens ? t("tokens", tokens) : undefined}>
              <Icon.DollarSign size={ICON_SIZE.inline} aria-hidden="true" style={s.costIcon} />
              <span style={s.costAmount}>
                <RunCostValue
                  usd={run.cost_usd}
                  source={run.cost_source}
                  missingReason={run.cost_missing_reason}
                />
              </span>
              {tokenArrow && <span aria-label={tokens ? t("tokens", tokens) : undefined}>{tokenArrow}</span>}
            </span>
          }
        />
      </>
    );
  }

  return (
    <section style={s.col}>
      <div style={s.briefLabel}>
        <Icon.FileText size={ICON_SIZE.inline} aria-hidden="true" />
        <span>{t("section")}</span>
      </div>
      {body}
    </section>
  );
}
