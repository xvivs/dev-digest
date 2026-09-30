import type { CSSProperties } from "react";

/** Co-located styles for AgentPicker. */
export const s = {
  chips: { display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 10px", padding: 0, listStyle: "none" } satisfies CSSProperties,
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 4px 3px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  none: { fontSize: 13, color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  removeBtn: {
    display: "inline-grid",
    placeItems: "center",
    width: 20,
    height: 20,
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
