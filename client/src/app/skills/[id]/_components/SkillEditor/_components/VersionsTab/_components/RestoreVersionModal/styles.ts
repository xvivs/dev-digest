import type { CSSProperties } from "react";

/** Co-located styles for RestoreVersionModal. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 10, padding: 20 } satisfies CSSProperties,
  text: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
  warning: {
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 6,
    padding: "8px 10px",
  } satisfies CSSProperties,
  error: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 6,
    padding: "8px 10px",
  } satisfies CSSProperties,
  errorText: { flex: 1 } satisfies CSSProperties,
} as const;
