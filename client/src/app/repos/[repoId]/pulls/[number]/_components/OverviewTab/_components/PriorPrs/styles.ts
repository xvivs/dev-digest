import type { CSSProperties } from "react";

export const s = {
  icon: { color: "var(--text-muted)" } satisfies CSSProperties,
  heading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chev: { marginLeft: "auto", display: "inline-flex" } satisfies CSSProperties,
  body: { paddingTop: 14 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  row: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" } satisfies CSSProperties,
  overlap: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } satisfies CSSProperties,
} as const;
