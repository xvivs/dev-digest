"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { MonoLink } from "@devdigest/ui";
import { ICON_SIZE } from "../../../../constants";
import { blastCallerHref } from "../../../../helpers";
import { s } from "./styles";

/** One changed symbol: a toggle row with its caller count, then callers (file:line), endpoints and crons. Caller paths link to GitHub when the repo and sha are known. */
function BlastSymbol({
  impact,
  repoFullName,
  sourceSha,
}: {
  impact: DownstreamImpact;
  repoFullName: string | null;
  sourceSha: string | null;
}) {
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
            {impact.callers.map((c, j) => {
              const href = blastCallerHref(repoFullName, sourceSha, c.file, c.line);
              const pathText = (
                <span style={s.callerPathText}>
                  {c.file}:{c.line}
                </span>
              );
              return (
                <li key={`${j}-${c.file}-${c.line}`} style={s.caller}>
                  <Icon.CornerDownRight size={ICON_SIZE.inline} aria-hidden="true" style={s.headIcon} />
                  <div style={s.callerBody}>
                    <span style={s.callerPath} title={`${c.file}:${c.line}`}>
                      {href ? <MonoLink href={href}>{pathText}</MonoLink> : pathText}
                    </span>
                    <span style={s.callerName}>{c.name}</span>
                  </div>
                </li>
              );
            })}
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

export interface BlastTreeProps {
  downstream: DownstreamImpact[];
  repoFullName: string | null;
  /** Revision the caller lines were read from (`source_sha`); empty/null → no links. */
  sourceSha: string | null;
}

export function BlastTree({ downstream, repoFullName, sourceSha }: BlastTreeProps) {
  return (
    <ul style={s.list}>
      {downstream.map((d, i) => (
        <BlastSymbol key={`${i}-${d.symbol}`} impact={d} repoFullName={repoFullName} sourceSha={sourceSha} />
      ))}
    </ul>
  );
}
