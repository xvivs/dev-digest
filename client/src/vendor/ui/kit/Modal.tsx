import React from "react";
import { IconBtn } from "../primitives";
import { useDialogFocus } from "../hooks";

export function Modal({
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
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 50, padding: 28 }}>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", animation: "ddfadein .15s ease" }}
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
          maxWidth: "100%",
          maxHeight: "92%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          outline: "none",
          animation: "ddpop .18s ease",
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
          <div style={{ flex: 1 }}>
            <h2 id={titleId} style={{ fontSize: 16, fontWeight: 700 }}>
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
        <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
        {footer && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "16px 24px", background: "var(--bg-surface)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
