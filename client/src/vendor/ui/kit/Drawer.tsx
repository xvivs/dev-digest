import React from "react";
import { IconBtn } from "../primitives";
import { useDialogFocus, usePrefersReducedMotion } from "../hooks";

/** Reveal (clip-path) and fade durations, ms. Hosts keep the drawer mounted this long while `exiting`. */
export const DRAWER_REVEAL_MS = 420;
export const DRAWER_FADE_MS = 150;

export function Drawer({
  width = 720,
  side = "right",
  title,
  subtitle,
  onClose,
  children,
  footer,
  ariaLabel,
  closeLabel = "Close",
  id,
  motion,
  topInset,
}: {
  width?: number;
  /** Edge the panel slides in from. Default `"right"`. */
  side?: "left" | "right";
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Close button, backdrop click and Escape all call this. */
  onClose?: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Accessible name when there is no visible `title` (otherwise the title names the dialog). */
  ariaLabel?: string;
  /** Accessible name of the close button — pass a translated string. */
  closeLabel?: string;
  /** Id of the dialog element (for a trigger's `aria-controls`). */
  id?: string;
  /**
   * Default: slide in from `side`. `reveal`: the panel grows out of `origin`
   * (viewport px, `clip-path: circle()`); reduced motion swaps that for a short
   * opacity fade. While `exiting` the exit animation plays and focus / Escape
   * handling stop (focus returns to the opener at once); the host unmounts
   * after `DRAWER_REVEAL_MS` (`DRAWER_FADE_MS` under reduced motion).
   */
  motion?: { kind: "reveal"; origin: { x: number; y: number }; exiting: boolean };
  /** Minimum header height (px), e.g. to leave room for a trigger layered over the top-left. */
  topInset?: number;
}) {
  const titleId = React.useId();
  const subtitleId = React.useId();
  const reveal = motion?.origin;
  const revealing = !!motion;
  const reduced = usePrefersReducedMotion();
  const closing = !!motion?.exiting;
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose, open: !closing });
  const left = side === "left";
  const EASE = "cubic-bezier(.2,.7,.3,1)";
  const panelAnimation = !revealing
    ? `${left ? "ddslideinleft" : "ddslidein"} .2s ${EASE}`
    : reduced
      ? `${closing ? "ddfadeout" : "ddfadein"} ${DRAWER_FADE_MS}ms ease both`
      : `${closing ? "ddrevealout" : "ddrevealin"} ${DRAWER_REVEAL_MS}ms ease-out ${closing ? "forwards" : "none"}`;
  const backdropAnimation = !revealing
    ? "ddfadein .15s ease"
    : `${closing ? "ddfadeout" : "ddfadein"} ${reduced ? DRAWER_FADE_MS : DRAWER_REVEAL_MS}ms ease-out both`;
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", justifyContent: left ? "flex-start" : "flex-end", zIndex: 50 }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          animation: backdropAnimation,
          pointerEvents: closing ? "none" : undefined,
        }}
      />
      <div
        ref={dialogRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        style={{
          position: "relative",
          width,
          maxWidth: "94%",
          background: "var(--bg-surface)",
          ...(left ? { borderRight: "1px solid var(--border-strong)" } : { borderLeft: "1px solid var(--border-strong)" }),
          boxShadow: left ? "var(--shadow-drawer-left)" : "var(--shadow-drawer)",
          display: "flex",
          flexDirection: "column",
          outline: "none",
          animation: panelAnimation,
          ...(reveal
            ? ({ "--origin-x": `${reveal.x}px`, "--origin-y": `${reveal.y}px` } as React.CSSProperties)
            : null),
          ...(closing ? { pointerEvents: "none" } : null),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: topInset ? "center" : "flex-start",
            gap: 14,
            padding: topInset ? "0 24px" : "18px 24px",
            minHeight: topInset,
            boxSizing: "border-box",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {title}
            </h2>
            {subtitle && (
              <div id={subtitleId} style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
          {onClose && <IconBtn icon="X" label={closeLabel} onClick={onClose} />}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>{children}</div>
        {footer && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "16px 24px", background: "var(--bg-primary)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
