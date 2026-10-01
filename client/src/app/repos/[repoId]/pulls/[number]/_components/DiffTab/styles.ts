import type { CSSProperties } from "react";

export const s = {
  headerRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  } satisfies CSSProperties,
  summary: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  add: { color: "var(--code-add-text)" } satisfies CSSProperties,
  del: { color: "var(--code-del-text)" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", marginBottom: 14 } satisfies CSSProperties,
} as const;
