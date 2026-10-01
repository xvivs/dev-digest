/* useMediaQuery — live `matchMedia` match as external-store state. The server
   snapshot is false (desktop / motion allowed); jsdom has no matchMedia → false. */
"use client";

import React from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
