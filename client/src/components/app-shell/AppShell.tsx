/* AppShell.tsx — thin orchestrator: wires @devdigest/ui AppFrame to the command
   palette, shortcuts help, global keyboard shortcuts, and the shell context.
   All concerns live in ./hooks; overlay open/close is local view state, and
   resetting it on a route change (the nav drawer) stays local to this file too. */
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AppFrame,
  CommandPalette,
  DefaultLink,
  Drawer,
  NAV_DRAWER_WIDTH,
  ShortcutsHelp,
  SidebarContent,
  VisuallyHidden,
  usePrefersReducedMotion,
  type Crumb,
  type NavOrigin,
  type ShellContext,
} from "@devdigest/ui";
import { NAV_EXIT_MS, NAV_EXIT_REDUCED_MS } from "./constants";
import { DRAWER_TOP_INSET, homeRow } from "./styles";
import { useGlobalShortcuts, useShellCommands, useShellContext } from "./hooks";

export function AppShell({ children, crumb }: { children: React.ReactNode; crumb?: Crumb[] }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openHelp = React.useCallback(() => setHelpOpen(true), []);
  const closeHelp = React.useCallback(() => setHelpOpen(false), []);
  const t = useTranslations("shell");
  const pathname = usePathname();
  // "closing" keeps the drawer mounted while its exit animation plays.
  const [navStatus, setNavStatus] = React.useState<"closed" | "open" | "closing">("closed");
  const [navOrigin, setNavOrigin] = React.useState<NavOrigin | null>(null);
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  const navDrawerId = React.useId();
  const reducedMotion = usePrefersReducedMotion();
  const navOpen = navStatus === "open";
  const closeNav = React.useCallback(() => setNavStatus((s) => (s === "open" ? "closing" : s)), []);
  const toggleNav = React.useCallback(
    (origin: NavOrigin) => {
      if (navOpen) return closeNav();
      setNavOrigin(origin);
      setNavStatus("open");
    },
    [navOpen, closeNav],
  );
  // Close the drawer on any route change (repo switch, g-chord, Back): adjust
  // state during render rather than in an effect.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setNavStatus("closed");
  }
  // Unmount once the exit animation is over (timer = external system).
  React.useEffect(() => {
    if (navStatus !== "closing") return;
    const id = setTimeout(() => setNavStatus("closed"), reducedMotion ? NAV_EXIT_REDUCED_MS : NAV_EXIT_MS);
    return () => clearTimeout(id);
  }, [navStatus, reducedMotion]);

  useGlobalShortcuts({ onOpenPalette: openPalette, onOpenHelp: openHelp });
  const commands = useShellCommands();
  const ctx = useShellContext({
    onOpenCommandPalette: openPalette,
    onToggleNav: toggleNav,
    navOpen,
    navDrawerId,
  });

  return (
    <>
      <AppFrame ctx={ctx} crumb={crumb}>
        {children}
      </AppFrame>
      {navStatus !== "closed" && (
        <Drawer
          id={navDrawerId}
          side="left"
          width={NAV_DRAWER_WIDTH}
          title={<VisuallyHidden>{t("navDrawer.title")}</VisuallyHidden>}
          closeLabel={t("ui.close")}
          onClose={closeNav}
          reveal={navOrigin}
          exiting={navStatus === "closing"}
          topInset={DRAWER_TOP_INSET}
        >
          <Home ctx={ctx} label={t("navDrawer.home")} onNavigate={closeNav} />
          <SidebarContent ctx={ctx} onNavigate={closeNav} />
        </Drawer>
      )}
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
    </>
  );
}

/** Way home on mobile, where the Topbar logo is the nav trigger rather than a link. */
function Home({ ctx, label, onNavigate }: { ctx: ShellContext; label: string; onNavigate: () => void }) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <Link href="/" onClick={onNavigate} style={homeRow}>
      {label}
    </Link>
  );
}
