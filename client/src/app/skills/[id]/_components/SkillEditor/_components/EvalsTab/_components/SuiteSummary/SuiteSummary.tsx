/* SuiteSummary — the latest started suite in one block (ADR 0017): verdict,
   mode and carrier, then either live progress (with Cancel), the result line
   "P/T passing · +caught · regressed · flaky · Δunexpected · $cost", or why
   the suite ended without results. Indicative and stale verdicts say why
   they are weak. */
"use client";

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

  return (
    <section aria-label={t("skillEvals.summary.label")} style={s.wrap}>
      <div style={s.head}>
        <VerdictBadge verdict={verdict} stale={suite.stale} />
        <Badge mono>{t(`skillEvals.summary.mode.${suite.mode}`)}</Badge>
        <span style={s.muted}>
          {suite.carrier_name
            ? t("skillEvals.summary.carrier", { name: suite.carrier_name })
            : t("skillEvals.summary.carrierDeleted")}
        </span>
        {running && (
          <Button kind="ghost" size="sm" icon="X" onClick={onCancel} disabled={cancelling} style={s.cancel}>
            {cancelling ? t("skillEvals.summary.cancelling") : t("skillEvals.summary.cancel")}
          </Button>
        )}
      </div>

      {results ? (
        <p style={s.line}>
          <strong style={s.strong}>
            {t("skillEvals.summary.passing", { passing: results.passing, total: results.total })}
          </strong>
          <Sep />
          <span>{t("skillEvals.summary.caught", { count: results.caught })}</span>
          <Sep />
          <span>{t("skillEvals.summary.regressed", { count: results.regressed })}</span>
          <Sep />
          <span>{t("skillEvals.summary.flaky", { count: results.flaky })}</span>
          <Sep />
          <span title={t("skillEvals.summary.deltaUnexpectedTitle")}>
            {t("skillEvals.summary.deltaUnexpected", { value: formatSignedDelta(results.delta_unexpected) })}
          </span>
          <Sep />
          <RunCostValue usd={suite.cost_usd} source={suite.cost_source} />
        </p>
      ) : running ? (
        <div role="status" style={s.progress}>
          <span style={s.muted}>{t("skillEvals.summary.running", { done: suite.done_jobs, total: suite.total_jobs })}</span>
          <div
            role="progressbar"
            aria-label={t("skillEvals.summary.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={suite.total_jobs}
            aria-valuenow={suite.done_jobs}
          >
            <ProgressBar value={percent} />
          </div>
        </div>
      ) : (
        <p role="alert" style={s.line}>
          {suite.error ??
            (suite.status === "cancelled" ? t("skillEvals.summary.cancelled") : t("skillEvals.summary.failed"))}
        </p>
      )}

      {results?.verdict === "indicative" && <p style={s.note}>{t("skillEvals.summary.indicativeNote")}</p>}
      {suite.stale && <p style={s.warnNote}>{t("skillEvals.summary.staleNote")}</p>}
    </section>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" style={s.sep}>
      ·
    </span>
  );
}
