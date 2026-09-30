/* useStickyOffset — mirrors the height of a sticky element into a CSS variable
   on another element, so content that sticks BELOW it (DiffTab's group headers)
   can use `top: var(--name)`. Returns callback refs, not RefObjects: the source
   mounts after the screen's loading early return, so a mount-only effect would
   see a null ref and never attach. Writes through style.setProperty: no React
   state, a resize re-renders nothing. With `fixedHeight` (mobile: the condensed
   bar) the var is that constant and nothing is measured. */
"use client";

import React from "react";
import { PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";

export function useStickyOffset(fixedHeight?: number): {
  setSource: (node: HTMLElement | null) => void;
  setTarget: (node: HTMLElement | null) => void;
} {
  const source = React.useRef<HTMLElement | null>(null);
  const target = React.useRef<HTMLElement | null>(null);
  const observer = React.useRef<ResizeObserver | null>(null);
  const fixed = React.useRef(fixedHeight);
  fixed.current = fixedHeight;

  // Re-attach whenever either node appears, changes or goes away.
  const attach = React.useCallback(() => {
    observer.current?.disconnect();
    observer.current = null;
    const src = source.current;
    const tgt = target.current;
    if (!tgt) return;
    if (fixed.current != null) {
      tgt.style.setProperty(PR_HEADER_OFFSET_VAR, `${fixed.current}px`);
      return;
    }
    if (!src) return;
    const write = () => tgt.style.setProperty(PR_HEADER_OFFSET_VAR, `${src.offsetHeight}px`);
    write();
    observer.current = new ResizeObserver(write);
    observer.current.observe(src);
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

  // A layout switch (fixed <-> measured) re-writes the var.
  React.useEffect(() => attach(), [fixedHeight, attach]);
  React.useEffect(() => () => observer.current?.disconnect(), []);

  return { setSource, setTarget };
}
