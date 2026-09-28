/* SeverityFilterBar — the findings toolbar's left half: a tally row of the
   severities actually present, and a filter row of all three levels.

   The tally only lists non-zero levels (a "0 CRITICAL" pill is noise), but the
   filter row always shows all three so the control set doesn't reflow as
   findings are accepted/dismissed — a level with nothing behind it is disabled
   instead of disappearing. Each filter is a `Chip` toggle: `active` drives
   `aria-pressed`, and `activeColor` paints the selected level in its own
   severity colour instead of the generic accent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, SEV } from "@devdigest/ui";
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
              <span style={s.count(SEV[level.severity].c)}>
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
            <Chip
              key={level.severity}
              active={active}
              activeColor={SEV[level.severity].c}
              disabled={count === 0}
              title={active ? t("panel.filter.clear") : undefined}
              onClick={() => onChange(active ? null : level.severity)}
            >
              {t(`panel.filter.${level.key}`)}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}
