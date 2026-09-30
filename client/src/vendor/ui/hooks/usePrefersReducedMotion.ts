import React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

const getSnapshot = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;

/** Live `prefers-reduced-motion: reduce` flag (false on the server and where matchMedia is missing). */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
