import type { CSSProperties } from "react";

/** SVG layout in viewBox units. */
export const GRAPH = { width: 520, rowHeight: 26, pad: 8, symX: 200, callerX: 260 } as const;

export const s = {
  svg: { width: "100%", height: "auto", display: "block" } satisfies CSSProperties,
  edge: { stroke: "var(--border-strong)", strokeWidth: 1 } satisfies CSSProperties,
  symbolText: { fill: "var(--text-primary)", fontSize: 11, fontWeight: 600 } satisfies CSSProperties,
  callerText: { fill: "var(--text-secondary)", fontSize: 11 } satisfies CSSProperties,
} as const;
