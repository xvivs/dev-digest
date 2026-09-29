import type { CSSProperties } from "react";

/** Co-located styles for SuiteSummary. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  cancel: { marginLeft: "auto" } satisfies CSSProperties,
  line: { fontSize: 13.5, color: "var(--text-secondary)", display: "flex", flexWrap: "wrap", gap: 6, margin: 0 } satisfies CSSProperties,
  strong: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  errored: { color: "var(--warn)", fontWeight: 600 } satisfies CSSProperties,
  sep: { color: "var(--text-muted)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  progress: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  warnNote: { fontSize: 12.5, color: "var(--warn)", margin: 0 } satisfies CSSProperties,
} as const;
