"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { s as shared } from "../../../../styles";
import { s } from "./styles";

/** Per changed symbol: its callers (name, file:line), affected endpoints and crons. Text only. */
export function BlastTree({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");
  return (
    <ul style={s.list}>
      {downstream.map((d, i) => (
        <li key={`${i}-${d.symbol}`} style={s.item}>
          <div style={shared.row}>
            <span style={s.symbol}>{d.symbol}</span>
            <span style={shared.muted}>{t("callerCount", { count: d.callers.length })}</span>
          </div>
          <ul style={s.callers}>
            {d.callers.map((c, j) => (
              <li key={`${j}-${c.file}-${c.line}`} style={shared.mono}>
                {c.name} · {c.file}:{c.line}
              </li>
            ))}
            {[...d.endpoints_affected, ...d.crons_affected].map((e, j) => (
              <li key={`x-${j}-${e}`} style={shared.mono}>
                {e}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
