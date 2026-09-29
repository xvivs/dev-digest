/* SuiteSummary — the latest suite as ONE thin line (ADR 0017, design-evals-spec):
   verdict chip · mode · carrier · "+caught · regressed · flaky · [N errored] ·
   Δunexpected · $cost", or live progress with Cancel, or why the suite ended
   without results. The "P / T passing" count lives in the tab header badge.
   Why a verdict is weak (indicative / stale) is the line's tooltip, not a
   paragraph. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ProgressBar } from "@devdigest/ui";
import type { EvalSuite } from "@devdigest/shared";
import { VerdictBadge } from "@/app/skills/_components/VerdictBadge";
import { formatSignedDelta } from "@/app/skills/helpers";
import { RunCostValue } from "@/components/run-cost-value";
import { s } from "./styles";

export function SuiteSummary({
  suite,
  onCancel,
  cancelling = false,
}: {
  suite: EvalSuite;
  onCancel: () => void;
  cancelling?: boolean;
}) {
  const t = useTranslations("eval");
  const results = suite.results;
  const running = suite.status === "running";
  // No results until `done` (spec): a running or failed suite has no verdict yet.
  const verdict = results?.verdict ?? "unknown";
  const percent = suite.total_jobs > 0 ? (suite.done_jobs / suite.total_jobs) * 100 : 0;
  const weak = [
    results?.verdict === "indicative" ? t("skillEvals.summary.indicativeNote") : null,
    suite.stale ? t("skillEvals.summary.staleNote") : null,
  ].filter(Boolean);

  return (
    <section aria-label={t("skillEvals.summary.label")} title={weak.length > 0 ? weak.join(" ") : undefined} style={s.wrap}>
      <Seg>
        <VerdictBadge verdict={verdict} stale={suite.stale} />
      </Seg>
      <Seg>
        <Badge mono>{t(`skillEvals.summary.mode.${suite.mode}`)}</Badge>
      </Seg>
      <Seg muted>
        {suite.carrier_name
          ? t("skillEvals.summary.carrier", { name: suite.carrier_name })
          : t("skillEvals.summary.carrierDeleted")}
      </Seg>

      {results ? (
        <>
          <Seg sep>{t("skillEvals.summary.caught", { count: results.caught })}</Seg>
          <Seg sep>{t("skillEvals.summary.regressed", { count: results.regressed })}</Seg>
          <Seg sep>{t("skillEvals.summary.flaky", { count: results.flaky })}</Seg>
          {results.errored > 0 && (
            <Seg sep errored title={t("skillEvals.summary.erroredTitle")}>
              {t("skillEvals.summary.errored", { count: results.errored })}
            </Seg>
          )}
          <Seg sep title={t("skillEvals.summary.deltaUnexpectedTitle")}>
            {t("skillEvals.summary.deltaUnexpected", { value: formatSignedDelta(results.delta_unexpected) })}
          </Seg>
          <Seg sep>
            <RunCostValue usd={suite.cost_usd} source={suite.cost_source} />
          </Seg>
        </>
      ) : running ? (
        <div role="status" style={s.progress}>
          <span style={s.muted}>{t("skillEvals.summary.running", { done: suite.done_jobs, total: suite.total_jobs })}</span>
          <div
            role="progressbar"
            aria-label={t("skillEvals.summary.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={suite.total_jobs}
            aria-valuenow={suite.done_jobs}
            style={s.bar}
          >
            <ProgressBar value={percent} />
          </div>
        </div>
      ) : (
        <span role="alert">
          {suite.error ??
            (suite.status === "cancelled" ? t("skillEvals.summary.cancelled") : t("skillEvals.summary.failed"))}
        </span>
      )}

      {running && (
        <Button kind="ghost" size="sm" icon="X" onClick={onCancel} disabled={cancelling} style={s.cancel}>
          {cancelling ? t("skillEvals.summary.cancelling") : t("skillEvals.summary.cancel")}
        </Button>
      )}
    </section>
  );
}

/**
 * One unbreakable segment of the line. The "·" separator lives inside it, so a
 * wrap can only happen between segments and a segment never splits (the cost
 * keeps its dot).
 */
function Seg({
  children,
  sep = false,
  muted = false,
  errored = false,
  title,
}: {
  children: React.ReactNode;
  sep?: boolean;
  muted?: boolean;
  errored?: boolean;
  title?: string;
}) {
  return (
    <span data-segment="" title={title} style={{ ...s.seg, ...(muted ? s.muted : null), ...(errored ? s.errored : null) }}>
      {sep && (
        <span aria-hidden="true" style={s.sep}>
          ·
        </span>
      )}
      {children}
    </span>
  );
}
