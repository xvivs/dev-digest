import type { CSSProperties } from "react";

/** Co-located styles for RestoreVersionModal. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 10, padding: 20 } satisfies CSSProperties,
  options: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  option: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  optionButton: { minWidth: 96 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 } satisfies CSSProperties,
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
