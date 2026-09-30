/* CondensedBar — the mobile PR header's pinned bar: "#number + title + primary
   action" over the tabs, at a fixed height. Hidden it is `inert` (no tab stop,
   out of the a11y tree) and, being a zero-height sticky anchor, costs no flow. */
"use client";

import React from "react";
import { s } from "./styles";

export interface CondensedBarProps {
  visible: boolean;
  /** prefers-reduced-motion: reduce — no slide/fade. */
  reducedMotion: boolean;
  number: number;
  title: string;
  /** Focus target when the full header's focus has to move here. */
  titleRef: React.Ref<HTMLButtonElement>;
  onTitleClick: (e: React.MouseEvent<HTMLElement>) => void;
  /** Primary action(s), right of the title. */
  actions: React.ReactNode;
  /** The tabs row. */
  children: React.ReactNode;
}

export function CondensedBar({
  visible,
  reducedMotion,
  number,
  title,
  titleRef,
  onTitleClick,
  actions,
  children,
}: CondensedBarProps) {
  return (
    <div style={s.anchor}>
      <div
        data-testid="condensed-bar"
        inert={!visible}
        aria-hidden={!visible}
        style={{ ...s.bar, ...(visible ? null : s.hidden), ...(reducedMotion ? s.instant : null) }}
      >
        <div style={s.row}>
          <button ref={titleRef} type="button" title={title} onClick={onTitleClick} style={s.titleButton}>
            <span className="mono" style={s.number}>
              #{number}
            </span>
            <span style={s.title}>{title}</span>
          </button>
          {actions}
        </div>
        <div style={s.tabs}>{children}</div>
      </div>
    </div>
  );
}
