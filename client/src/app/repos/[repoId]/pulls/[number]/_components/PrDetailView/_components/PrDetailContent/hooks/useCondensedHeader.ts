/* useCondensedHeader — which PR header layout is in force.
   "desktop": sticky full header (unchanged). "mobile" (< md): the full header
   scrolls with the content. "condensed": it has scrolled away, so the fixed-height
   bar is shown. One IntersectionObserver on a sentinel at the full header's bottom
   edge decides; there is no scroll handler and no hysteresis, because nothing in
   the flow changes when the bar shows, so nothing can feed back.
   matchMedia is only the behaviour gate (observer on/off, which header is sticky);
   visual differences live in --dd-prh-* vars. Callback ref, for the same reason as
   useStickyOffset: the sentinel mounts after the loading early return. */
"use client";

import React from "react";
import { MOBILE_QUERY, type HeaderLayout } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { useMediaQuery } from "./useMediaQuery";

export function useCondensedHeader(): {
  layout: HeaderLayout;
  setSentinel: (node: HTMLElement | null) => void;
} {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [past, setPast] = React.useState(false);
  const detach = React.useRef<(() => void) | null>(null);

  const setSentinel = React.useCallback((node: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!node) return;
    const root = node.closest("main");
    // Guard: nothing inside <main> may anchor-adjust its scroll position.
    const prevAnchor = root?.style.overflowAnchor ?? "";
    if (root) root.style.overflowAnchor = "none";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Gone AND above the top edge = the header has scrolled away.
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0));
      },
      { root },
    );
    observer.observe(node);
    detach.current = () => {
      observer.disconnect();
      if (root) root.style.overflowAnchor = prevAnchor;
    };
  }, []);

  React.useEffect(() => () => detach.current?.(), []);

  return { layout: !mobile ? "desktop" : past ? "condensed" : "mobile", setSentinel };
}
