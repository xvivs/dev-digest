/* CondensedBar — the mobile PR header's pinned bar: "#number + title + primary
   action" over the tabs, at a fixed height. Hidden it is `inert` (no tab stop,
   out of the a11y tree) and, being a zero-height sticky anchor, costs no flow. */
"use client";

import React from "react";
import { barFor, s } from "./styles";

export interface CondensedBarProps {
  /** Bar root (React 19 ref-as-prop): the header checks whether focus is inside before hiding it. */
  ref?: React.Ref<HTMLDivElement>;
  visible: boolean;
  /** prefers-reduced-motion: reduce — no slide/fade. */
  reducedMotion: boolean;
  number: number;
  title: string;
  onTitleClick: (e: React.MouseEvent<HTMLElement>) => void;
  /** Primary action(s), right of the title. */
  actions: React.ReactNode;
  /** The tabs row. */
  children: React.ReactNode;
}

export function CondensedBar({
  ref,
  visible,
  reducedMotion,
  number,
  title,
  onTitleClick,
  actions,
  children,
}: CondensedBarProps) {
  return (
    <div style={s.anchor}>
      <div
        ref={ref}
        inert={!visible}
        aria-hidden={!visible}
        style={barFor(visible, reducedMotion)}
      >
        <div style={s.row}>
          <button type="button" title={title} onClick={onTitleClick} style={s.titleButton}>
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
