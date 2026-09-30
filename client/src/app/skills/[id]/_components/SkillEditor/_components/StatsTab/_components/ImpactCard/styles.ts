import type { CSSProperties } from "react";

/** Co-located styles for ImpactCard. */
export const s = {
  body: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  text: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  strong: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  results: { display: "flex", alignItems: "center", gap: 14 } satisfies CSSProperties,
  resultLines: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  warnNote: { fontSize: 12.5, color: "var(--warn)", margin: 0 } satisfies CSSProperties,
} as const;
