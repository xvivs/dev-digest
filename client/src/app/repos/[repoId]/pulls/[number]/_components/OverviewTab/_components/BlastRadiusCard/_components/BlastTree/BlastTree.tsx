"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { ICON_SIZE } from "../../../../constants";
import { s } from "./styles";

/** One changed symbol: a toggle row with its caller count, then callers (file:line), endpoints and crons. Text only. */
function BlastSymbol({ impact }: { impact: DownstreamImpact }) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(true);
  const bodyId = React.useId();
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
  return (
    <li style={s.item}>
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)} style={s.head}>
        <Chevron size={ICON_SIZE.inline} aria-hidden="true" style={s.headIcon} />
        <Icon.Code size={ICON_SIZE.inline} aria-hidden="true" style={s.headIcon} />
        <span style={s.symbol}>{impact.symbol}</span>
        <span style={s.count}>{t("callerCount", { count: impact.callers.length })}</span>
      </button>
      {open && (
        <div id={bodyId}>
          <ul style={s.callers}>
            {impact.callers.map((c, j) => (
              <li key={`${j}-${c.file}-${c.line}`} style={s.caller}>
                <Icon.CornerDownRight size={ICON_SIZE.inline} aria-hidden="true" style={s.headIcon} />
                <span>
                  {c.file}:{c.line}
                </span>
                <span style={s.callerName}>{c.name}</span>
              </li>
            ))}
          </ul>
          {(impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0) && (
            <div style={s.chips}>
              {impact.endpoints_affected.map((e, j) => (
                <span key={`e-${j}-${e}`} style={s.chipEndpoint}>
                  <Icon.Globe size={ICON_SIZE.inline} aria-hidden="true" />
                  {e}
                </span>
              ))}
              {impact.crons_affected.map((c, j) => (
                <span key={`c-${j}-${c}`} style={s.chipCron}>
                  <Icon.Clock size={ICON_SIZE.inline} aria-hidden="true" />
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function BlastTree({ downstream }: { downstream: DownstreamImpact[] }) {
  return (
    <ul style={s.list}>
      {downstream.map((d, i) => (
        <BlastSymbol key={`${i}-${d.symbol}`} impact={d} />
      ))}
    </ul>
  );
}
