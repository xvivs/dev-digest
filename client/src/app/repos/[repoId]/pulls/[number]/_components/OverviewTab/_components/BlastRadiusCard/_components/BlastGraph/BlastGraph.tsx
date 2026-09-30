"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH_MAX_CALLERS } from "../../../../constants";
import { s as shared } from "../../../../styles";
import { GRAPH, s } from "./styles";

/** Symbols on the left, their callers on the right, joined by lines. At most GRAPH_MAX_CALLERS callers are drawn. */
export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");

  const symbols = downstream.map((d) => d.symbol);
  const edges = downstream.flatMap((d, si) => d.callers.map((c) => ({ from: si, label: `${c.name}:${c.line}` })));
  if (edges.length === 0) return <div style={shared.muted}>{t("graph.empty")}</div>;

  const shown = edges.slice(0, GRAPH_MAX_CALLERS);
  const hidden = edges.length - shown.length;
  const rows = Math.max(symbols.length, shown.length);
  const height = rows * GRAPH.rowHeight + GRAPH.pad * 2;
  const symY = (i: number) => GRAPH.pad + i * GRAPH.rowHeight + GRAPH.rowHeight / 2;

  return (
    <div>
      <svg role="img" aria-label={t("graph.ariaLabel")} viewBox={`0 0 ${GRAPH.width} ${height}`} style={s.svg}>
        {shown.map((e, i) => (
          <line key={`l-${i}`} x1={GRAPH.symX} y1={symY(e.from)} x2={GRAPH.callerX} y2={symY(i)} style={s.edge} />
        ))}
        {symbols.map((sym, i) => (
          <text key={`s-${i}-${sym}`} x={GRAPH.symX} y={symY(i)} textAnchor="end" dominantBaseline="middle" style={s.symbolText}>
            {sym}
          </text>
        ))}
        {shown.map((e, i) => (
          <text key={`c-${i}-${e.label}`} x={GRAPH.callerX + 6} y={symY(i)} dominantBaseline="middle" style={s.callerText}>
            {e.label}
          </text>
        ))}
      </svg>
      {hidden > 0 && <div style={shared.muted}>+{hidden}</div>}
    </div>
  );
}
