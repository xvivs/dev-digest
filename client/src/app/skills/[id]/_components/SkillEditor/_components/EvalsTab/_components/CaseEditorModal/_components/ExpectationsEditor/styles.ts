import type { CSSProperties } from "react";

const cellBase = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } as const satisfies CSSProperties;

/** Co-located styles for ExpectationsEditor. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  kinds: { border: "none", margin: 0, padding: 0, display: "flex", gap: 20, flexWrap: "wrap" } satisfies CSSProperties,
  kind: { display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13.5 } satisfies CSSProperties,
  kindTitle: { display: "block", fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 } satisfies CSSProperties,
  hint: { display: "block", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    flexWrap: "wrap",
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  cell: { ...cellBase, width: 120 } satisfies CSSProperties,
  cellNarrow: { ...cellBase, width: 76 } satisfies CSSProperties,
  cellWide: { ...cellBase, flex: "1 1 180px" } satisfies CSSProperties,
  cellLabel: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  input: {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
    width: "100%",
  } satisfies CSSProperties,
  remove: { marginLeft: "auto" } satisfies CSSProperties,
} as const;
