"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrReviews, usePrRuns } from "@/lib/hooks";
import { RunCostValue } from "@/components/run-cost-value";
import { VerdictBanner } from "@/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner";
import { formatTokenPair, selectLatestBrief } from "../../helpers";
import { s } from "../../styles";

/**
 * The newest finished review as a verdict banner with its cost/tokens aside.
 * Reads the same query keys as PrDetailContent (usePrRuns / usePrReviews), so
 * no extra request; owns its own loading and error states.
 */
export function BriefSection({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const runs = usePrRuns(prId);
  const reviews = usePrReviews(prId);

  const brief = React.useMemo(
    () => (runs.data && reviews.data ? selectLatestBrief(runs.data, reviews.data) : null),
    [runs.data, reviews.data],
  );

  const isError = runs.isError || reviews.isError;
  const retry = () => {
    if (runs.isError) runs.refetch();
    if (reviews.isError) reviews.refetch();
  };

  let body: React.ReactNode;
  if (isError) {
    body = <ErrorState title={t("error")} onRetry={retry} />;
  } else if (runs.isLoading || reviews.isLoading) {
    body = <Skeleton height={86} />;
  } else if (!brief) {
    body = <EmptyState icon="Sparkles" title={t("noRun")} body={t("unavailableHint")} />;
  } else {
    const { run, review, verdict, newerRun } = brief;
    const tokens = formatTokenPair(run.tokens_in, run.tokens_out);
    body = (
      <>
        {newerRun && (
          <div style={s.notice} role="status">
            <Icon.Info size={15} aria-hidden="true" />
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
            <>
              <span>
                <RunCostValue
                  usd={run.cost_usd}
                  source={run.cost_source}
                  missingReason={run.cost_missing_reason}
                />
              </span>
              {tokens && <span>{t("tokens", tokens)}</span>}
            </>
          }
        />
      </>
    );
  }

  return (
    <section style={s.col}>
      <SectionLabel icon="Sparkles">{t("section")}</SectionLabel>
      {body}
    </section>
  );
}
