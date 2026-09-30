"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH } from "../../../../constants";
import { blastGraphLayout } from "../../../../helpers";
import { s as shared } from "../../../../styles";
import { s } from "./styles";

/** Symbols on the left, their callers on the right, joined by lines. At most GRAPH_MAX_CALLERS callers are drawn. */
export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");

  const layout = blastGraphLayout(downstream);
  if (!layout) return <div style={shared.muted}>{t("graph.empty")}</div>;
  const { height, symbols, callers, hidden } = layout;

  return (
    <div>
      <svg role="img" aria-label={t("graph.ariaLabel")} viewBox={`0 0 ${GRAPH.width} ${height}`} style={s.svg}>
        {callers.map((c, i) => (
          <line key={`l-${i}`} x1={GRAPH.symX} y1={c.fromY} x2={GRAPH.callerX} y2={c.y} style={s.edge} />
        ))}
        {symbols.map((sym, i) => (
          <text key={`s-${i}-${sym.label}`} x={GRAPH.symX} y={sym.y} textAnchor="end" dominantBaseline="middle" style={s.symbolText}>
            {sym.label}
          </text>
        ))}
        {callers.map((c, i) => (
          <text key={`c-${i}-${c.label}`} x={GRAPH.callerX + GRAPH.labelGap} y={c.y} dominantBaseline="middle" style={s.callerText}>
            {c.label}
          </text>
        ))}
      </svg>
      {hidden > 0 && <div style={shared.muted}>{t("graph.more", { count: hidden })}</div>}
    </div>
  );
}
