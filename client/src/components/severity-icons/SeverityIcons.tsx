/**
 * SeverityIcons — the one place that renders a findings breakdown as
 * "icon + count" chips. Used on every surface that shows a severity tally
 * (PR list cell, review header, the FindingsPopover anchor).
 *
 * Two render shapes, one layout:
 *  - with `onSelect` → a <button> per severity (a filter control);
 *  - without        → a <span tabIndex={0}> per severity, so the cell is still
 *                     keyboard-reachable when it is only a popover anchor.
 *
 * Only non-zero severities render, worst first; an all-zero tally renders
 * nothing at all (the caller owns the "no findings" dash — `findings.cell.none`).
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity, SeverityCounts } from "@devdigest/shared";
import { DEFAULT_SIZE } from "./constants";
import { SEV_KEY, presentSeverities } from "./helpers";
import { s } from "./styles";

function SeverityIconsBase({
  counts,
  size = DEFAULT_SIZE,
  selected,
  onSelect,
}: {
  /** Severity tally, lowercase wire keys. Use `countBySeverity` to build one. */
  counts: SeverityCounts;
  /** Icon + number size in px. Defaults to 12. */
  size?: number;
  /** Currently filtered severity, when the caller drives a filter. */
  selected?: Severity | null;
  /** Present → each severity becomes a real button. Absent → inert, focusable spans. */
  onSelect?: (s: Severity) => void;
}) {
  const t = useTranslations("findings");
  const present = presentSeverities(counts);

  if (present.length === 0) return null;

  return (
    <span style={s.row}>
      {present.map((sev) => {
        const token = SEV[sev];
        const SevIcon = Icon[token.icon];
        const count = counts[SEV_KEY[sev]];
        const label = t("cell.label", { count, severity: token.label });
        const active = selected === sev;

        const body = (
          <>
            <SevIcon size={size} style={s.icon(token.c)} aria-hidden />
            <span className="tnum" style={s.count(size)}>
              {count}
            </span>
          </>
        );

        return onSelect ? (
          <button
            key={sev}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onSelect(sev)}
            style={s.item(true, active)}
          >
            {body}
          </button>
        ) : (
          <span key={sev} tabIndex={0} aria-label={label} style={s.item(false, active)}>
            {body}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Memoised: this renders once per row of a PR list that re-polls every 60s, and
 * `counts` is a stable object across polls when nothing changed.
 */
export const SeverityIcons = React.memo(SeverityIconsBase);
