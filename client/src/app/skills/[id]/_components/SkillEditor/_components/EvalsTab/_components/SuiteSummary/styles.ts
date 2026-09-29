import type { CSSProperties } from "react";

/** Co-located styles for SuiteSummary: one thin line under the header (design-evals-spec: no caption block). */
export const s = {
  wrap: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px 10px",
    padding: "8px 12px",
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  seg: { display: "inline-flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" } satisfies CSSProperties,
  cancel: { marginLeft: "auto" } satisfies CSSProperties,
  errored: { color: "var(--warn)", fontWeight: 600 } satisfies CSSProperties,
  sep: { color: "var(--text-muted)" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  progress: { display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 } satisfies CSSProperties,
  bar: { flex: 1, minWidth: 80 } satisfies CSSProperties,
} as const;
