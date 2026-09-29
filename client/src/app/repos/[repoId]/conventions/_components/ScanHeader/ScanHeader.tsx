/* ScanHeader — page title, "Detected from N sample files · last scan X ago",
   Re-scan, and the stats strip of the scan the candidates come from (AC-34).
   While a scan runs or after one failed, the header says so and never passes the older
   scan's numbers off as the current one.
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
  runningScan = null,
  failedScan = null,
  onRescan,
  scanning,
  rescanDisabled,
}: {
  repoName: string;
  /** The scan whose candidates are listed (latest finished one); null before the first scan. */
  scan: ConventionScan | null;
  /** The scan running now. While set, the header speaks only about it: no stats of an older scan. */
  runningScan?: ConventionScan | null;
  /** The latest scan when it failed; `scan` then is the older one the candidates still come from. */
  failedScan?: ConventionScan | null;
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
  const ago = (s: ConventionScan) => format.relativeTime(new Date(s.finished_at ?? s.started_at), new Date());
  const when = scan ? ago(scan) : null;
  const hasScanned = scan !== null || runningScan !== null || failedScan !== null;
  // A running scan has no results yet; a failed one shows the older results, labelled as such.
  const showStats = scan !== null && runningScan === null;
  let subtitle: string;
  let olderNote: string | null = null;
  if (runningScan) {
    subtitle = t("header.scanning", { when: ago(runningScan) });
  } else if (failedScan) {
    subtitle = t("header.failed", { when: ago(failedScan) });
    if (scan) {
      olderNote = t("header.showingFrom", {
        date: format.dateTime(new Date(scan.finished_at ?? scan.started_at), { dateStyle: "medium" }),
      });
    }
  } else {
    subtitle = scan ? t("header.detected", { count: scan.sample_file_count, when: when ?? "" }) : t("page.subtitle");
  }
  const duration = scan ? formatDuration(scan.duration_ms) : null;
  const tokens =
    scan && scan.tokens_in != null && scan.tokens_out != null
      ? t("stats.tokensValue", { input: formatTokenCount(scan.tokens_in), output: formatTokenCount(scan.tokens_out) })
      : none;

  const stats: { key: string; label: string; value: ReactNode }[] = scan && showStats
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
          <p style={s.subtitle}>{subtitle}</p>
          {olderNote && <p style={s.olderNote}>{olderNote}</p>}
        </div>
        {hasScanned && (
          <Button
            kind="secondary"
            icon="RefreshCw"
            onClick={onRescan}
            disabled={scanning || runningScan !== null || rescanDisabled}
            loading={scanning || runningScan !== null}
          >
            {scanning || runningScan ? t("page.scanning") : t("page.rescan")}
          </Button>
        )}
      </div>
      {showStats && (
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
