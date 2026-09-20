/* SeverityFilterBar — the findings toolbar's left half: a tally row of the
   severities actually present, and a filter row of all three levels.

   The tally only lists non-zero levels (a "0 CRITICAL" pill is noise), but the
   filter row always shows all three so the control set doesn't reflow as
   findings are accepted/dismissed — a level with nothing behind it is disabled
   instead of disappearing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SEV } from "@devdigest/ui";
import type { Severity, SeverityCounts } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "./constants";
import { s } from "./styles";

export function SeverityFilterBar({
  counts,
  value,
  onChange,
}: {
  /** Tally of the findings the list is about to render — see FindingsPanel. */
  counts: SeverityCounts;
  value: Severity | null;
  /** Clicking the already-active level clears the filter (`null`). */
  onChange: (next: Severity | null) => void;
}) {
  const t = useTranslations("prReview");
  // One hovered key for the whole row — cheaper than a state hook per chip.
  const [hovered, setHovered] = React.useState<Severity | null>(null);

  const tallied = SEVERITY_LEVELS.filter((level) => counts[level.key] > 0);

  return (
    <div style={s.root}>
      {tallied.length > 0 && (
        <div style={s.counts}>
          {tallied.map((level, i) => (
            <React.Fragment key={level.severity}>
              {i > 0 && (
                <span style={s.separator} aria-hidden="true">
                  ·
                </span>
              )}
              <span style={{ color: SEV[level.severity].c }}>
                {t(`panel.counts.${level.key}`, { count: counts[level.key] })}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      <div style={s.filters}>
        {SEVERITY_LEVELS.map((level) => {
          const count = counts[level.key];
          const active = value === level.severity;
          return (
            <button
              key={level.severity}
              type="button"
              disabled={count === 0}
              aria-pressed={active}
              title={active ? t("panel.filter.clear") : undefined}
              onClick={() => onChange(active ? null : level.severity)}
              onMouseEnter={() => setHovered(level.severity)}
              onMouseLeave={() =>
                setHovered((h) => (h === level.severity ? null : h))
              }
              style={s.chip({
                active,
                disabled: count === 0,
                hovered: hovered === level.severity,
                color: SEV[level.severity].c,
              })}
            >
              {t(`panel.filter.${level.key}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
