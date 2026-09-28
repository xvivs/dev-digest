import type { CSSProperties } from "react";
import { LIST_PANE_WIDTH } from "./constants";

/** Co-located styles for SkillsListPane. */
export const s = {
  pane: {
    width: LIST_PANE_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  header: { padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  skeletonGap: { marginBottom: 10 } satisfies CSSProperties,
} as const;
