import React from "react";
import type { ShellContext } from "./types";
import { SidebarContent } from "./SidebarContent";

export function Sidebar({ ctx }: { ctx: ShellContext }) {
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
      <SidebarContent ctx={ctx} />
    </aside>
  );
}
