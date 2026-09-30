/* useHeaderCollapse — drives the mobile PR header's compact state from two
   sentinels inside <main> (no scroll handler). Passing the COLLAPSE sentinel
   off the top collapses; the EXPAND sentinel (nearer the top) coming back into
   view expands; in between nothing changes (hysteresis). Callback refs, for the
   same reason as useStickyOffset: the sentinels mount after the loading return. */
"use client";

import React from "react";
import { MOBILE_QUERY, REDUCED_MOTION_QUERY } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { useMediaQuery } from "./useMediaQuery";

export function useHeaderCollapse(): {
  mobile: boolean;
  compact: boolean;
  reducedMotion: boolean;
  setCollapseSentinel: (node: HTMLElement | null) => void;
  setExpandSentinel: (node: HTMLElement | null) => void;
} {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [scrolled, setScrolled] = React.useState(false);
  const collapseNode = React.useRef<HTMLElement | null>(null);
  const expandNode = React.useRef<HTMLElement | null>(null);
  const observer = React.useRef<IntersectionObserver | null>(null);

  const attach = React.useCallback(() => {
    observer.current?.disconnect();
    observer.current = null;
    const collapse = collapseNode.current;
    const expand = expandNode.current;
    if (!collapse || !expand) {
      setScrolled(false);
      return;
    }
    const root = collapse.closest("main");
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === collapse) {
            // Gone AND above the top edge = scrolled past it (not merely below a tiny viewport).
            if (!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)) setScrolled(true);
          } else if (entry.target === expand && entry.isIntersecting) {
            setScrolled(false);
          }
        }
      },
      { root },
    );
    observer.current.observe(collapse);
    observer.current.observe(expand);
  }, []);

  const setCollapseSentinel = React.useCallback(
    (node: HTMLElement | null) => {
      collapseNode.current = node;
      attach();
    },
    [attach],
  );
  const setExpandSentinel = React.useCallback(
    (node: HTMLElement | null) => {
      expandNode.current = node;
      attach();
    },
    [attach],
  );

  React.useEffect(() => () => observer.current?.disconnect(), []);

  return { mobile, compact: mobile && scrolled, reducedMotion, setCollapseSentinel, setExpandSentinel };
}
