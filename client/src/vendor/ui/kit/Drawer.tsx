import React from "react";
import { IconBtn } from "../primitives";
import { useDialogFocus } from "../hooks";

export function Drawer({
  width = 720,
  title,
  subtitle,
  onClose,
  children,
  footer,
  ariaLabel,
  closeLabel = "Close",
}: {
  width?: number;
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
}) {
  const titleId = React.useId();
  const subtitleId = React.useId();
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", animation: "ddfadein .15s ease" }}
      />
      <div
        ref={dialogRef}
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
          borderLeft: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-drawer)",
          display: "flex",
          flexDirection: "column",
          outline: "none",
          animation: "ddslidein .2s cubic-bezier(.2,.7,.3,1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            padding: "18px 24px",
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
