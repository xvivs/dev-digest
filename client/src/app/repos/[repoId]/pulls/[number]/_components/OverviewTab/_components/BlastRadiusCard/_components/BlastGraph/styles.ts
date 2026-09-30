import type { CSSProperties } from "react";

export const s = {
  svg: { width: "100%", height: "auto", display: "block" } satisfies CSSProperties,
  edge: { stroke: "var(--border-strong)", strokeWidth: 1 } satisfies CSSProperties,
  symbolText: { fill: "var(--text-primary)", fontSize: 11, fontWeight: 600 } satisfies CSSProperties,
  callerText: { fill: "var(--text-secondary)", fontSize: 11 } satisfies CSSProperties,
} as const;
