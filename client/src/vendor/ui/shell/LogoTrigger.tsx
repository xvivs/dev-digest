import React from "react";
import { Logo } from "./Logo";
import type { ShellContext } from "./types";

/** Above the nav Drawer / Modal (z 50), below the command palette (z 60). */
const OPEN_Z_INDEX = 55;

/**
 * Mobile nav trigger: the logo itself is the button (below md only). While the
 * drawer is open it is layered above it, so it stays in place and closes it.
 * Its mark spins on hover / focus / press and rests rotated 90deg when open
 * (see `.dd-logo-trigger` in styles.css).
 */
export function LogoTrigger({ ctx }: { ctx: ShellContext }) {
  const open = !!ctx.navOpen;
  const label = open ? (ctx.labels?.closeNav ?? "Close navigation") : (ctx.labels?.openNav ?? "Open navigation");
  return (
    <button
      ref={ctx.navTriggerRef}
      type="button"
      className="dd-logo-trigger dd-show-below-md"
      aria-label={label}
      aria-expanded={open}
      aria-controls={ctx.navDrawerId}
      aria-haspopup="dialog"
      onClick={(e) => {
        const mark = e.currentTarget.querySelector("[data-logo-mark]") ?? e.currentTarget;
        const r = mark.getBoundingClientRect();
        ctx.onToggleNav?.({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      style={{
        // 44x44 minimum hit area; the negative margin keeps the mark on the page gutter.
        minWidth: 44,
        minHeight: 44,
        padding: "0 8px",
        margin: "0 0 0 -8px",
        display: "inline-flex",
        alignItems: "center",
        border: 0,
        background: "transparent",
        color: "var(--text-primary)",
        position: "relative",
        zIndex: open ? OPEN_Z_INDEX : undefined,
      }}
    >
      <Logo size="sm" />
    </button>
  );
}
