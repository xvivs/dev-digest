"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore, RowAction } from "@devdigest/ui";
import type {
  RunSummary,
  PrCommit,
  FindingRecord,
  Severity,
  SeverityCounts,
} from "@devdigest/shared";
import { RunCostValue } from "@/components/run-cost-value";
import { SeverityIcons, ZERO_COUNTS } from "@/components/severity-icons";
import { FindingsPopover } from "@/components/findings-popover";
import { LocalTime } from "@/components/local-time";
import { OUTCOME_META, SHORT_SHA_LENGTH } from "./constants";
import { buildTimeline, formatTokenTotal, outcomeOf } from "./helpers";
import { s } from "./styles";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; clicking a run row opens its trace. The badge is the review OUTCOME
 * (see `outcomeOf`), not the run lifecycle.
 */

/** Stable default for the optional lookup maps: a `new Map()` in a default
 *  parameter is a fresh object every render and would defeat every memo below. */
const EMPTY_MAP: ReadonlyMap<string, never> = new Map<string, never>();

/** Keeps a click on a nested control from also opening the row's trace. */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export interface RunHistoryProps {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** run_id → that run's findings, for the hover popover. Optional: the
   *  timeline still renders standalone, just without the severity strip. */
  findingsByRun?: ReadonlyMap<string, FindingRecord[]>;
  /** run_id → severity tally. Its key set doubles as "this run has a review",
   *  which is what gates the chips being clickable. */
  countsByRun?: ReadonlyMap<string, SeverityCounts>;
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name,
   *  or a severity chip — which also pre-filters the panel to that severity). */
  onGoToReview?: (runId: string, severity?: Severity) => void;
  onDelete?: (runId: string) => void;
}

export function RunHistory({
  runs,
  commits = [],
  findingsByRun = EMPTY_MAP,
  countsByRun = EMPTY_MAP,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: RunHistoryProps) {
  const t = useTranslations("prReview");
  // One stable handler per run rather than an arrow in the row's JSX: a fresh
  // closure every render would defeat the `React.memo` on `SeverityIcons` just
  // as surely as a fresh counts object. Only runs that actually resolved to a
  // review get one — a chip with no review behind it would be a dead button.
  const selectHandlers = React.useMemo(() => {
    const handlers = new Map<string, (severity: Severity) => void>();
    if (!onGoToReview) return handlers;
    for (const runId of countsByRun.keys()) {
      handlers.set(runId, (severity) => onGoToReview(runId, severity));
    }
    return handlers;
  }, [countsByRun, onGoToReview]);

  const [hoveredRun, setHoveredRun] = React.useState<string | null>(null);

  if (runs.length === 0 && commits.length === 0) return null;

  const items = buildTimeline(runs, commits);

  return (
    <div style={s.list}>
      {items.map((item) => {
        if (item.kind === "commit") {
          const c = item.commit;
          return (
            <div key={`commit:${c.sha}`} style={s.commitRow}>
              <Icon.GitCommit size={15} style={s.commitIcon} />
              <span className="mono" style={s.commitSha}>
                {c.sha.slice(0, SHORT_SHA_LENGTH)}
              </span>
              <span style={s.commitMessage} title={c.message}>
                {c.message.split("\n")[0]}
              </span>
              <span style={s.commitMeta}>{c.author}</span>
              {c.committed_at && <LocalTime iso={c.committed_at} style={s.commitMeta} />}
            </div>
          );
        }

        const r = item.run;
        const outcome = outcomeOf(r);
        const o = OUTCOME_META[outcome];
        const settled = r.status === "done";
        const tokenTotal = formatTokenTotal(r.tokens_in, r.tokens_out);
        return (
          // The whole panel opens the trace drawer; nested controls (agent name,
          // severity chips, row actions) stop propagation so their own click
          // behaviour wins. The row stays a `<div>`, not a `<button>` — it
          // already nests `<button>`s, and nested interactive elements are
          // invalid — so `Open run trace & logs` remains the keyboard path in.
          <div
            key={`run:${r.run_id}`}
            data-run-id={r.run_id}
            style={s.row(hoveredRun === r.run_id)}
            onMouseEnter={() => setHoveredRun(r.run_id)}
            onMouseLeave={() => setHoveredRun((prev) => (prev === r.run_id ? null : prev))}
            onClick={() => onOpenTrace(r.run_id)}
          >
            <Badge color={o.color} bg={o.bg} icon={o.icon}>
              {t(`runStatus.${outcome}`)}
            </Badge>
            {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
            <div style={s.main}>
              <div style={s.titleLine}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGoToReview?.(r.run_id);
                  }}
                  title={t("timeline.goToReview")}
                  style={s.agentButton(!!onGoToReview)}
                >
                  {r.agent_name ?? t("timeline.agentFallback")}
                </button>{" "}
                <span className="mono" style={s.model}>
                  {r.provider}/{r.model}
                </span>
              </div>
              {r.status === "failed" && r.error && (
                <div style={s.error} title={r.error}>
                  {r.error}
                </div>
              )}
              {settled && (
                // The severity strip REPLACES the old "N finding(s)" text — it
                // carries the same total, broken down and clickable. Blockers
                // stay as text: they're a gate outcome, not a severity.
                <div style={s.findingsLine}>
                  {/* Not a control: only keeps chip clicks from bubbling to the row. */}
                  <span onClick={stop}>
                    <FindingsPopover
                      total={r.findings_count ?? 0}
                      findings={findingsByRun.get(r.run_id)}
                      runLinked={countsByRun.has(r.run_id)}
                    >
                      <SeverityIcons
                        counts={countsByRun.get(r.run_id) ?? ZERO_COUNTS}
                        size={13}
                        onSelect={selectHandlers.get(r.run_id)}
                      />
                    </FindingsPopover>
                  </span>
                  {(r.blockers ?? 0) > 0 && (
                    <span>{t("runStatus.blockers", { count: r.blockers ?? 0 })}</span>
                  )}
                </div>
              )}
            </div>
            <div style={s.side}>
              {r.ran_at && <LocalTime iso={r.ran_at} />}
              <span className="tnum" style={s.cost}>
                {tokenTotal && `${tokenTotal} · `}
                <RunCostValue usd={r.cost_usd} source={r.cost_source} missingReason={r.cost_missing_reason} />
              </span>
            </div>
            <div style={s.actions}>
              <RowAction icon="Copy" label={t("timeline.openTrace")} onClick={() => onOpenTrace(r.run_id)} />
              {onDelete && r.status !== "running" && (
                <RowAction
                  icon="Trash"
                  label={t("timeline.deleteRun")}
                  tone="danger"
                  onClick={() => onDelete(r.run_id)}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
