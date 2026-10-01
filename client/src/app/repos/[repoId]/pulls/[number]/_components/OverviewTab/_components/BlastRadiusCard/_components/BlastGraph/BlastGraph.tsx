"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH } from "../../../../constants";
import { blastCallerHref, blastGraphLayout } from "../../../../helpers";
import { s as shared } from "../../../../styles";
import { s } from "./styles";

/** Symbols on the left, their callers on the right, joined by lines. At most GRAPH_MAX_CALLERS callers are drawn. */
export interface BlastGraphProps {
  downstream: DownstreamImpact[];
  repoFullName: string | null;
  /** Revision the caller lines were read from (`source_sha`); empty/null → no links. */
  sourceSha: string | null;
}

export function BlastGraph({ downstream, repoFullName, sourceSha }: BlastGraphProps) {
  const t = useTranslations("blast");

  const layout = blastGraphLayout(downstream);
  if (!layout) return <div style={shared.muted}>{t("graph.empty")}</div>;
  const { height, symbols, callers, hidden } = layout;

  return (
    <div>
      <svg role="group" aria-label={t("graph.ariaLabel")} viewBox={`0 0 ${GRAPH.width} ${height}`} style={s.svg}>
        {callers.map((c, i) => (
          <line key={`l-${i}`} x1={GRAPH.symX} y1={c.fromY} x2={GRAPH.callerX} y2={c.y} style={s.edge} aria-hidden="true" />
        ))}
        {symbols.map((sym, i) => (
          <text key={`s-${i}-${sym.label}`} x={GRAPH.symX} y={sym.y} textAnchor="end" dominantBaseline="middle" style={s.symbolText}>
            {sym.label}
          </text>
        ))}
        {callers.map((c, i) => {
          const href = blastCallerHref(repoFullName, sourceSha, c.file, c.line);
          const label = (
            <text x={GRAPH.callerX + GRAPH.labelGap} y={c.y} dominantBaseline="middle" style={href ? s.callerLinkText : s.callerText}>
              {c.label}
            </text>
          );
          return href ? (
            <a
              key={`c-${i}-${c.label}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${c.label} (${c.file})`}
            >
              {label}
            </a>
          ) : (
            <React.Fragment key={`c-${i}-${c.label}`}>{label}</React.Fragment>
          );
        })}
      </svg>
      {hidden > 0 && <div style={shared.muted}>{t("graph.more", { count: hidden })}</div>}
    </div>
  );
}
