import React from "react";
import { NavItem } from "./NavItem";
import { DefaultLink } from "./DefaultLink";
import type { ShellContext } from "./types";
import type { NavItemDef } from "../nav";

const HOME: NavItemDef = { key: "home", label: "Home", labelKey: "nav.home", icon: "Layers", href: "/" };

/** "Home" row, styled as a nav item. Mobile nav drawer only: there the logo is the trigger, not a link. */
export function HomeNavItem({
  ctx,
  label,
  active,
  onNavigate,
}: {
  ctx: ShellContext;
  label: string;
  active?: boolean;
  onNavigate?: () => void;
}) {
  return <NavItem item={HOME} label={label} active={active} Link={ctx.Link ?? DefaultLink} onNavigate={onNavigate} />;
}
