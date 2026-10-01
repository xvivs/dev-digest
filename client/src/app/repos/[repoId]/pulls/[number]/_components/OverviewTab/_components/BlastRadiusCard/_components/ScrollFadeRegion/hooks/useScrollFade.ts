import React from "react";

/** Distance (px) from the bottom still treated as "scrolled to the end". */
const BOTTOM_TOLERANCE = 2;

/** Tracks whether a scroll container has more content below the fold. Re-measures on scroll and on resize of the box or its children. */
export function useScrollFade() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = React.useState(false);

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflowing = el.scrollHeight > el.clientHeight;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_TOLERANCE;
    setShowFade(overflowing && !atBottom);
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [measure]);

  return { ref, showFade, onScroll: measure };
}
