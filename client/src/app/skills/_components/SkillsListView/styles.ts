import type { CSSProperties } from "react";
import { TOPBAR_HEIGHT } from "@devdigest/ui";

/** Co-located styles for SkillsListView (the two-pane /skills screen, no id selected). */
export const s = {
  layout: { display: "flex", height: `calc(100vh - ${TOPBAR_HEIGHT}px)` } satisfies CSSProperties,
  content: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
