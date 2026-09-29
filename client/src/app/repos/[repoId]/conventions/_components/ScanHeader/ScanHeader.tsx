/* ScanHeader — page title, "Detected from N sample files · last scan X ago",
   Re-scan, and the stats strip of the scan the candidates come from (AC-34).
   Presentational: the view owns the scan data and the extract mutation. */
"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { ConventionScan } from "@devdigest/shared";
import { RunCostValue } from "@/components/run-cost-value";
import { formatDuration, formatTokenCount } from "./helpers";
import { s } from "./styles";

export function ScanHeader({
  repoName,
  scan,
  onRescan,
  scanning,
  rescanDisabled,
}: {
  repoName: string;
  /** The scan whose candidates are listed (latest finished one); null before the first scan. */
  scan: ConventionScan | null;
  onRescan: () => void;
  /** A scan is running: the button says so and stays disabled. */
  scanning: boolean;
  /** Extra reasons to hold the button (e.g. the repo is not indexed). */
  rescanDisabled: boolean;
}) {
  const t = useTranslations("conventions");
  const format = useFormatter();
  const none = t("stats.none");

  // `now` is explicit: next-intl has no global default here, and this only renders once the
  // scan has loaded on the client, so there is no server/client markup to mismatch.
  const when = scan ? format.relativeTime(new Date(scan.finished_at ?? scan.started_at), new Date()) : null;
  const duration = scan ? formatDuration(scan.duration_ms) : null;
  const tokens =
    scan && scan.tokens_in != null && scan.tokens_out != null
      ? t("stats.tokensValue", { input: formatTokenCount(scan.tokens_in), output: formatTokenCount(scan.tokens_out) })
      : none;

  const stats: { key: string; label: string; value: ReactNode }[] = scan
    ? [
        { key: "found", label: t("stats.found"), value: scan.found_count },
        { key: "verified", label: t("stats.verified"), value: scan.verified_count },
        { key: "dropped", label: t("stats.dropped"), value: scan.dropped_count },
        { key: "relocated", label: t("stats.relocated"), value: scan.relocated_count },
        { key: "model", label: t("stats.model"), value: scan.model ?? none },
        { key: "tokens", label: t("stats.tokens"), value: tokens },
        { key: "cost", label: t("stats.cost"), value: <RunCostValue usd={scan.cost_usd} source={scan.cost_source} /> },
        { key: "duration", label: t("stats.duration"), value: duration ?? none },
      ]
    : [];

  return (
    <header>
      <div style={s.head}>
        <div style={s.titleWrap}>
          <h1 style={s.title}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repo}>
              {repoName}
            </span>
          </h1>
          <p style={s.subtitle}>
            {scan ? t("header.detected", { count: scan.sample_file_count, when: when ?? "" }) : t("page.subtitle")}
          </p>
        </div>
        <Button
          kind="secondary"
          icon="RefreshCw"
          onClick={onRescan}
          disabled={scanning || rescanDisabled}
          loading={scanning}
        >
          {scanning ? t("page.scanning") : t("page.rescan")}
        </Button>
      </div>
      {scan && (
        <dl role="group" aria-label={t("stats.label")} style={s.stats}>
          {stats.map((stat) => (
            <div key={stat.key} style={s.stat}>
              <dt style={s.statLabel}>{stat.label}</dt>
              <dd className="tnum" style={s.statValue}>
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
