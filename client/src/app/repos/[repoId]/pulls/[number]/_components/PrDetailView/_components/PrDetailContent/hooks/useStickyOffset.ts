/* useStickyOffset — mirrors the height of a sticky element into a CSS variable
   on another element, so content that sticks BELOW it (DiffTab's group headers)
   can use `top: var(--name)`. Returns callback refs, not RefObjects: the source
   mounts after the screen's loading early return, so a mount-only effect would
   see a null ref and never attach. Writes through style.setProperty: no React
   state, a resize re-renders nothing.

   It also keeps PR_HEADER_FULL_OFFSET_VAR = the header's height while expanded.
   It is frozen while the source is compact (`data-compact="true"`) and while the
   meta-row collapse transition runs, so a body that reserves `full - live` keeps
   the scroll flow constant across collapse and expand. */
"use client";

import React from "react";
import { PR_HEADER_FULL_OFFSET_VAR, PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";

/** The CSS property the header's meta row animates (see PrDetailHeader). */
const COLLAPSE_PROPERTY = "grid-template-rows";

export function useStickyOffset(): {
  setSource: (node: HTMLElement | null) => void;
  setTarget: (node: HTMLElement | null) => void;
} {
  const source = React.useRef<HTMLElement | null>(null);
  const target = React.useRef<HTMLElement | null>(null);
  const detach = React.useRef<(() => void) | null>(null);

  // Re-attach whenever either node appears, changes or goes away.
  const attach = React.useCallback(() => {
    detach.current?.();
    detach.current = null;
    const src = source.current;
    const tgt = target.current;
    if (!src || !tgt) return;
    // Only the collapsible's own transition freezes the full height; hover
    // transitions on buttons inside the header must not.
    let collapsing = 0;
    const write = () => {
      const h = `${src.offsetHeight}px`;
      tgt.style.setProperty(PR_HEADER_OFFSET_VAR, h);
      if (src.dataset.compact !== "true" && collapsing === 0) tgt.style.setProperty(PR_HEADER_FULL_OFFSET_VAR, h);
    };
    const onRun = (e: TransitionEvent) => {
      if (e.propertyName === COLLAPSE_PROPERTY) collapsing++;
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== COLLAPSE_PROPERTY) return;
      collapsing = Math.max(0, collapsing - 1);
      write();
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(src);
    src.addEventListener("transitionrun", onRun);
    src.addEventListener("transitionend", onEnd);
    src.addEventListener("transitioncancel", onEnd);
    detach.current = () => {
      ro.disconnect();
      src.removeEventListener("transitionrun", onRun);
      src.removeEventListener("transitionend", onEnd);
      src.removeEventListener("transitioncancel", onEnd);
    };
  }, []);

  const setSource = React.useCallback(
    (node: HTMLElement | null) => {
      source.current = node;
      attach();
    },
    [attach],
  );
  const setTarget = React.useCallback(
    (node: HTMLElement | null) => {
      target.current = node;
      attach();
    },
    [attach],
  );

  React.useEffect(() => () => detach.current?.(), []);

  return { setSource, setTarget };
}
