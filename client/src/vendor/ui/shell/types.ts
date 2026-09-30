import type React from "react";

/** Minimal Link contract — Next's <Link> satisfies this. */
export type LinkLike = React.ComponentType<{
  href: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onClick?: () => void;
}>;

export interface RepoSummary {
  id: string;
  full_name: string;
  default_branch?: string;
  syncedLabel?: string;
}

export interface ShellContext {
  Link?: LinkLike;
  /** Active nav key (e.g. "pulls"). */
  activeKey?: string;
  /** Active repo id, used to fill :repoId in hrefs. */
  repoId?: string | null;
  repos?: RepoSummary[];
  activeRepo?: RepoSummary | null;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onOpenCommandPalette?: () => void;
  /**
   * Toggles the navigation drawer; the Topbar shows the logo trigger only when
   * set. `origin` is the logo mark's centre (viewport px) the drawer grows from.
   */
  onToggleNav?: (origin: NavOrigin) => void;
  /** Drives the trigger's `aria-expanded` and open-state mark rotation. */
  navOpen?: boolean;
  /** id of the drawer dialog, for the trigger's `aria-controls`. */
  navDrawerId?: string;
  /**
   * Translated Topbar labels (the design system has no i18n of its own).
   * Missing entries fall back to English.
   */
  labels?: { openNav?: string; closeNav?: string; search?: string };
  onSelectRepo?: (id: string) => void;
  /** Invoked when the user picks "Add repository…" in the repo switcher. */
  onAddRepo?: () => void;
  /** Invoked when the user removes a repo via the trash action in the switcher. */
  onRemoveRepo?: (id: string) => void;
  onRefresh?: () => void;
  prCount?: number;
  /**
   * Resolves a nav item's `labelKey` (e.g. `useTranslations("shell")`'s `t`).
   * The design system has no i18n of its own; without this, `NavItemDef.label`
   * (English) is shown.
   */
  translateNav?: (labelKey: `nav.${string}`) => string;
}

export interface Crumb {
  label: string;
  mono?: boolean;
  href?: string;
}

/** Viewport point (px) the nav drawer's reveal grows from. */
export interface NavOrigin {
  x: number;
  y: number;
}
