import React from "react";
import { Icon } from "../icons";
import { NAV, SETTINGS_ITEM } from "../nav";
import { DefaultLink } from "./DefaultLink";
import type { ShellContext } from "./types";
import { NavItem } from "./NavItem";
import { RepoSwitcher } from "./RepoSwitcher";

/** Width (px) of the left navigation drawer that hosts `SidebarContent`. */
export const NAV_DRAWER_WIDTH = 304;

/**
 * The sidebar's content (logo, repo switcher, nav, settings). Owns its column
 * layout so it renders the same in the fixed aside and in a block Drawer body.
 */
export function SidebarContent({ ctx, onNavigate }: { ctx: ShellContext; onNavigate?: () => void }) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0 }}>
      <Link href="/" onClick={onNavigate}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 5px 14px" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--text-primary)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Layers size={15} style={{ color: "var(--bg-primary)" }} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>DevDigest</span>
        </div>
      </Link>
      <RepoSwitcher ctx={ctx} />
      <div style={{ overflowY: "auto", flex: 1, margin: "5px -5px 0", padding: "0 5px" }}>
        {NAV.map((grp, gi) => (
          <div key={gi} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--text-muted)",
                padding: "0 14px",
                marginBottom: 8,
              }}
            >
              {grp.section}
            </div>
            {grp.items.map((it) => (
              <NavItem
                key={it.key}
                item={it.key === "pulls" && ctx.prCount != null ? { ...it, badge: String(ctx.prCount) } : it}
                active={ctx.activeKey === it.key}
                repoId={ctx.repoId}
                Link={Link}
                onNavigate={onNavigate}
                label={ctx.translateNav?.(it.labelKey)}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 2 }}>
        <NavItem
          item={SETTINGS_ITEM}
          active={ctx.activeKey === "settings"}
          repoId={ctx.repoId}
          Link={Link}
          onNavigate={onNavigate}
          label={ctx.translateNav?.(SETTINGS_ITEM.labelKey)}
        />
      </div>
    </div>
  );
}
