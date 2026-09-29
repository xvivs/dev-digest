import type { CSSProperties } from "react";

/** Co-located styles for PrSourcePicker. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  field: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  fieldset: { border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  select: {
    padding: "9px 10px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 14,
  } satisfies CSSProperties,
  files: {
    listStyle: "none",
    margin: 0,
    padding: "6px 0",
    maxHeight: 220,
    overflowY: "auto",
    border: "1px solid var(--border)",
    borderRadius: 7,
  } satisfies CSSProperties,
  file: { display: "flex", alignItems: "center", gap: 10, padding: "4px 10px", cursor: "pointer", fontSize: 13 } satisfies CSSProperties,
  path: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  stats: { fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
} as const;
