import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 880, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  caption: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  item: { borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  rowTop: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  noNote: { fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  when: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  gap: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  gapHint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
