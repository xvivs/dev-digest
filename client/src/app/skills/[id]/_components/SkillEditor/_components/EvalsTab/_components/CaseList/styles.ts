import type { CSSProperties } from "react";

/** Co-located styles for CaseList. */
export const s = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px 16px",
    flexWrap: "wrap",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  main: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: "1 1 220px" } satisfies CSSProperties,
  name: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  meta: { display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  legacy: { color: "var(--warn)" } satisfies CSSProperties,
  result: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  arm: { fontSize: 12.5, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 2, flexShrink: 0, marginLeft: "auto" } satisfies CSSProperties,
} as const;
