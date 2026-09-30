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
  Drawer,
  NAV_DRAWER_WIDTH,
  ShortcutsHelp,
  SidebarContent,
  type Crumb,
} from "@devdigest/ui";
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
  const [navOpen, setNavOpen] = React.useState(false);
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  const openNav = React.useCallback(() => setNavOpen(true), []);
  const closeNav = React.useCallback(() => setNavOpen(false), []);
  // Close the drawer on any route change (repo switch, g-chord, Back): adjust
  // state during render rather than in an effect.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setNavOpen(false);
  }

  useGlobalShortcuts({ onOpenPalette: openPalette, onOpenHelp: openHelp });
  const commands = useShellCommands();
  const ctx = useShellContext({ onOpenCommandPalette: openPalette, onOpenNav: openNav });

  return (
    <>
      <AppFrame ctx={ctx} crumb={crumb}>
        {children}
      </AppFrame>
      {navOpen && (
        <Drawer
          side="left"
          width={NAV_DRAWER_WIDTH}
          title={t("navDrawer.title")}
          closeLabel={t("ui.close")}
          onClose={closeNav}
        >
          <SidebarContent ctx={ctx} onNavigate={closeNav} />
        </Drawer>
      )}
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
    </>
  );
}
