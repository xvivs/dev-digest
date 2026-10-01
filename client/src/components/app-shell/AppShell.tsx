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
  DRAWER_FADE_MS,
  DRAWER_REVEAL_MS,
  Drawer,
  HomeNavItem,
  NAV_DRAWER_WIDTH,
  ShortcutsHelp,
  SidebarContent,
  VisuallyHidden,
  usePrefersReducedMotion,
  type Crumb,
  type NavOrigin,
} from "@devdigest/ui";
import { DRAWER_TOP_INSET } from "./styles";
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
  const navTriggerRef = React.useRef<HTMLButtonElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const navOpen = navStatus === "open";
  // Return focus to the logo on every close path. The Drawer's useDialogFocus
  // restores the previously active element (not the trigger when the click did
  // not focus it: Safari never focuses buttons on click) from an effect cleanup
  // that runs after this handler, so focus is moved on the next frame, after it.
  const closeNav = React.useCallback(() => {
    if (!navOpen) return;
    setNavStatus("closing");
    requestAnimationFrame(() => navTriggerRef.current?.focus());
  }, [navOpen]);
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
    const id = setTimeout(() => setNavStatus("closed"), reducedMotion ? DRAWER_FADE_MS : DRAWER_REVEAL_MS);
    return () => clearTimeout(id);
  }, [navStatus, reducedMotion]);

  useGlobalShortcuts({ onOpenPalette: openPalette, onOpenHelp: openHelp });
  const commands = useShellCommands();
  const ctx = useShellContext({
    onOpenCommandPalette: openPalette,
    onToggleNav: toggleNav,
    navOpen,
    navDrawerId,
    navTriggerRef,
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
          motion={navOrigin ? { kind: "reveal", origin: navOrigin, exiting: navStatus === "closing" } : undefined}
          topInset={DRAWER_TOP_INSET}
        >
          <HomeNavItem ctx={ctx} label={t("navDrawer.home")} active={pathname === "/"} onNavigate={closeNav} />
          <SidebarContent ctx={ctx} onNavigate={closeNav} />
        </Drawer>
      )}
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
    </>
  );
}
