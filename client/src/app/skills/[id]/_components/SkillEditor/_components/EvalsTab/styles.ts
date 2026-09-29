import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { maxWidth: 960, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  caption: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  never: { fontSize: 13, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  modalBody: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, padding: 24 } satisfies CSSProperties,
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
