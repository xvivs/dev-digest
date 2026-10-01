import type { CSSProperties } from "react";

export const s = {
  /** The Overview tab's header row: right-aligned. */
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  link: { fontSize: 13, color: "var(--accent)" } satisfies CSSProperties,
} as const;
