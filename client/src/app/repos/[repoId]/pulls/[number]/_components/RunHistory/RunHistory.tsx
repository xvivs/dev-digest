"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore, type IconName } from "@devdigest/ui";
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
import { formatTokenTotal } from "./helpers";
import { RowAction } from "./_components/RowAction";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; clicking a run row opens its trace.
 *
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected" (red), never a green "done". Outcome
 * is derived from the denormalized blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */

type Outcome = { key: string; color: string; bg: string; icon: IconName };

function outcomeOf(run: RunSummary): Outcome {
  const status = run.status ?? "";
  if (status === "running")
    return { key: "running", color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed")
    return { key: "error", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "cancelled")
    return { key: "cancelled", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" };
  // Settled ("done"): color by the deterministic outcome.
  if ((run.blockers ?? 0) > 0)
    return { key: "rejected", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if ((run.findings_count ?? 0) > 0)
    return { key: "reviewed", color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" };
  return { key: "approved", color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}

function rowStyle(hovered: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: hovered ? "var(--bg-hover)" : "var(--bg-elevated)",
    textAlign: "left",
    transition: "background .12s",
    cursor: "pointer",
  };
}

/** The two trailing actions travel together, spaced wider than the row's gap —
 *  roughly one glyph-width apart, so "open trace" and "delete" never read as a
 *  single control the way a tight pair of borderless icons would. */
const actionsStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 16,
  marginLeft: 6,
  flexShrink: 0,
};

// Commits are markers, not actions — lighter (dashed, transparent) so they read
// as separators between the runs they sit chronologically between.
const commitRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px dashed var(--border)",
  background: "transparent",
};

/** Stable default for the optional lookup maps: a `new Map()` in a default
 *  parameter is a fresh object every render and would defeat every memo below. */
const EMPTY_MAP: ReadonlyMap<string, never> = new Map<string, never>();

const findingsLineStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "var(--text-muted)",
};

type TimelineItem =
  | { kind: "run"; ts: number; run: RunSummary }
  | { kind: "commit"; ts: number; commit: PrCommit };

/** Epoch ms for sorting; unparseable / missing timestamps sort last. */
function tsOf(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

export function RunHistory({
  runs,
  commits = [],
  findingsByRun = EMPTY_MAP,
  countsByRun = EMPTY_MAP,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
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
}) {
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

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({
      kind: "commit" as const,
      ts: tsOf(commit.committed_at),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) => {
        if (item.kind === "commit") {
          const c = item.commit;
          return (
            <div key={`commit:${c.sha}`} style={commitRowStyle}>
              <Icon.GitCommit size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              {/* Accent-tinted like every other code reference in the app — the
                  sha is the one token in this row that identifies a commit. */}
              <span className="mono" style={{ fontSize: 12, color: "var(--accent-text)", flexShrink: 0 }}>
                {c.sha.slice(0, 7)}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={c.message}
              >
                {c.message.split("\n")[0]}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{c.author}</span>
              {c.committed_at && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                  {new Date(c.committed_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          );
        }

        const r = item.run;
        const o = outcomeOf(r);
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
            style={rowStyle(hoveredRun === r.run_id)}
            onMouseEnter={() => setHoveredRun(r.run_id)}
            onMouseLeave={() => setHoveredRun((prev) => (prev === r.run_id ? null : prev))}
            onClick={() => onOpenTrace(r.run_id)}
          >
            <Badge color={o.color} bg={o.bg} icon={o.icon}>
              {t(`runStatus.${o.key}`)}
            </Badge>
            {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGoToReview?.(r.run_id);
                  }}
                  title={t("timeline.goToReview")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    font: "inherit",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    cursor: onGoToReview ? "pointer" : "default",
                    // No underline: the design keeps the agent name as plain
                    // text. `title` + the pointer carry the affordance instead.
                    textDecoration: "none",
                  }}
                >
                  {r.agent_name ?? "Agent"}
                </button>{" "}
                <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
                  {r.provider}/{r.model}
                </span>
              </div>
              {r.status === "failed" && r.error && (
                <div
                  style={{ fontSize: 12, color: "var(--crit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={r.error}
                >
                  {r.error}
                </div>
              )}
              {settled && (
                // The severity strip REPLACES the old "N finding(s)" text — it
                // carries the same total, broken down and clickable. Blockers
                // stay as text: they're a gate outcome, not a severity.
                <div style={findingsLineStyle}>
                  <span onClick={(e) => e.stopPropagation()}>
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {r.ran_at && <span>{new Date(r.ran_at).toLocaleTimeString()}</span>}
              <span className="tnum" style={{ color: "var(--text-secondary)" }}>
                {tokenTotal && `${tokenTotal} · `}
                <RunCostValue usd={r.cost_usd} source={r.cost_source} missingReason={r.cost_missing_reason} />
              </span>
            </div>
            <div style={actionsStyle}>
              <RowAction icon="Copy" label={t("timeline.openTrace")} onClick={() => onOpenTrace(r.run_id)} />
              {onDelete && r.status !== "running" && (
                <RowAction icon="Trash" label={t("timeline.deleteRun")} danger onClick={() => onDelete(r.run_id)} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
