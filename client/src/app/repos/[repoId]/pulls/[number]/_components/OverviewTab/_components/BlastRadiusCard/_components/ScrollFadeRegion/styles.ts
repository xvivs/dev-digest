import type { CSSProperties } from "react";
import { BLAST_BODY_MAX_HEIGHT } from "../../styles";

/** Height (px) of the bottom fade hint. */
const FADE_HEIGHT = 32;

export const s = {
  wrap: { position: "relative" } satisfies CSSProperties,
  scrollBody: {
    maxHeight: BLAST_BODY_MAX_HEIGHT,
    overflowY: "auto",
    overscrollBehavior: "contain",
  } satisfies CSSProperties,
  /** Matches the card background (`--bg-elevated`), so it works in both themes. */
  fade: (visible: boolean): CSSProperties => ({
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_HEIGHT,
    pointerEvents: "none",
    background: "linear-gradient(to bottom, transparent, var(--bg-elevated))",
    opacity: visible ? 1 : 0,
    transition: "opacity 150ms ease",
  }),
};
