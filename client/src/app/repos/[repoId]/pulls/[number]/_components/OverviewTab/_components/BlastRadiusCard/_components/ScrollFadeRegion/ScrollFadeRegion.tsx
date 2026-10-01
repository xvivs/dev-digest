"use client";

import React from "react";
import { useScrollFade } from "./hooks/useScrollFade";
import { s } from "./styles";

/** Focusable, height-capped scroll region with a bottom fade while more content is hidden below. */
export function ScrollFadeRegion({ label, children }: { label: string; children: React.ReactNode }) {
  const { ref, contentRef, showFade, onScroll } = useScrollFade();
  return (
    <div style={s.wrap}>
      <div ref={ref} role="region" aria-label={label} tabIndex={0} style={s.scrollBody} onScroll={onScroll}>
        <div ref={contentRef}>{children}</div>
      </div>
      <div aria-hidden="true" data-testid="scroll-fade" data-visible={showFade} style={s.fade(showFade)} />
    </div>
  );
}
