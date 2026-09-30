import type { CSSProperties } from "react";

/** Co-located styles for RejectConfirmModal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  copy: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 } satisfies CSSProperties,
  usedIn: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  link: { fontSize: 14, color: "var(--accent-text)" } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
