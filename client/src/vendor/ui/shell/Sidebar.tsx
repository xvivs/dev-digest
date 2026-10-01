import React from "react";
import type { ShellContext } from "./types";
import { DefaultLink } from "./DefaultLink";
import { Logo } from "./Logo";
import { SidebarContent } from "./SidebarContent";

export function Sidebar({ ctx }: { ctx: ShellContext }) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <aside
      className="dd-hide-below-md"
      style={{
        width: 264,
        flexShrink: 0,
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "24px 14px 16px",
        gap: 2,
        overflow: "hidden",
      }}
    >
      <Link href="/">
        <div style={{ padding: "2px 5px 14px" }}>
          <Logo />
        </div>
      </Link>
      <SidebarContent ctx={ctx} />
    </aside>
  );
}
