import React from "react";
import { Icon } from "../icons";
import { IconBtn, Avatar, Kbd } from "../primitives";
import { DefaultLink } from "./DefaultLink";
import { Logo } from "./Logo";
import type { ShellContext, Crumb } from "./types";

/** Topbar height (px). Screens that fill the viewport under it subtract this. */
export const TOPBAR_HEIGHT = 52;

export function Topbar({ ctx, crumb = [] }: { ctx: ShellContext; crumb?: Crumb[] }) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <header
      style={{
        height: TOPBAR_HEIGHT,
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "center",
        gap: "var(--dd-topbar-gap)",
        padding: "0 var(--dd-topbar-pad-x)",
        position: "relative",
      }}
    >
      {ctx.onOpenNav && (
        <IconBtn
          icon="Menu"
          label={ctx.labels?.openNav ?? "Open navigation"}
          className="dd-show-below-md"
          hasPopup="dialog"
          onClick={ctx.onOpenNav}
        />
      )}
      {/* Below md the logo is centered in the header; crumbs would collide with it, so they hide. */}
      <div
        className="dd-show-below-md"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      >
        <Logo size="sm" />
      </div>
      <div
        className="dd-hide-below-md"
        style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 auto", overflow: "hidden" }}
      >
        {crumb.map((c, i) => {
          const last = i === crumb.length - 1;
          // Ancestors shrink first; the current page keeps its width up to 75% of the row.
          const itemStyle: React.CSSProperties = {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: last ? "0 0 auto" : "0 1 auto",
            ...(last ? { maxWidth: "75%" } : null),
          };
          const text = (
            <span
              className={c.mono ? "mono" : undefined}
              title={c.label}
              style={{
                fontSize: 14,
                fontWeight: last ? 600 : 500,
                color: last ? "var(--text-primary)" : "var(--text-secondary)",
                ...(c.href ? null : itemStyle),
                ...(c.href ? { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : null),
              }}
            >
              {c.label}
            </span>
          );
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <Icon.ChevronRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              )}
              {c.href ? (
                <Link href={c.href} style={itemStyle}>
                  {text}
                </Link>
              ) : (
                text
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="dd-show-below-md" style={{ flex: 1 }} />
      <button
        type="button"
        className="dd-hide-below-lg"
        onClick={ctx.onOpenCommandPalette}
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: 260,
          padding: "8px 14px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Icon.Search size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <IconBtn
        icon="Search"
        label={ctx.labels?.search ?? "Search"}
        className="dd-show-below-lg"
        onClick={ctx.onOpenCommandPalette}
      />
      {ctx.onToggleTheme && (
        <IconBtn
          icon={ctx.theme === "light" ? "Moon" : "Sun"}
          label="Toggle theme"
          onClick={ctx.onToggleTheme}
        />
      )}
      {ctx.onRefresh && <IconBtn icon="RefreshCw" label="Refresh" onClick={ctx.onRefresh} />}
      <IconBtn icon="Bell" label="Notifications" className="dd-hide-below-md" />
      <Avatar name="you" size={26} />
    </header>
  );
}
