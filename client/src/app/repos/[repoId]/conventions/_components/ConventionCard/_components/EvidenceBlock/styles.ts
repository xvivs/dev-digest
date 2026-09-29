import type { CSSProperties } from "react";

/** Co-located styles for EvidenceBlock. */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  location: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "none",
  } satisfies CSSProperties,
  copyBtn: (hover: boolean): CSSProperties => ({
    display: "inline-grid",
    placeItems: "center",
    width: 26,
    height: 26,
    border: "none",
    borderRadius: 5,
    background: hover ? "var(--bg-hover)" : "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  }),
  copied: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  code: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
} as const;
