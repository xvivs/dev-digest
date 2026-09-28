"use client";

import { createContext, useContext } from "react";

/**
 * Dirty-form navigation guard for the skill editor (SPEC-02 AC-8): switching
 * to another skill or tab while the Config tab has unsaved changes asks for
 * confirmation first. `beforeunload` is handled separately by the Config tab
 * itself (a real browser event, not a client-side navigation).
 *
 * `SkillEditorView` owns the real guard (a mutable ref so a keystroke doesn't
 * re-render the whole editor) and renders the confirm Modal; the Config tab
 * reports its dirty flag through `setDirty`; anything that navigates away
 * (`SkillCard`, the tab bar, the editor's own "Add" menu) routes through
 * `confirmNavigation` instead of navigating directly. Outside an editor route
 * (e.g. the bare `/skills` list, which has no dirty form to guard) every
 * consumer gets the no-op default below.
 */
export interface NavigationGuard {
  setDirty: (dirty: boolean) => void;
  /** Runs `proceed` at once when nothing is dirty; otherwise asks first. */
  confirmNavigation: (proceed: () => void) => void;
}

const NOOP_GUARD: NavigationGuard = {
  setDirty: () => {},
  confirmNavigation: (proceed) => proceed(),
};

export const NavigationGuardContext = createContext<NavigationGuard>(NOOP_GUARD);

export function useNavigationGuard(): NavigationGuard {
  return useContext(NavigationGuardContext);
}
