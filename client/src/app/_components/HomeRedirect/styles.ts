import type { CSSProperties } from "react";

/** Co-located styles for HomeRedirect (CSSProperties over CSS vars — ADR 0003). */
export const s = {
  skeleton: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 } satisfies CSSProperties,
  redirecting: { color: "var(--text-secondary)", marginBottom: 14 } satisfies CSSProperties,
} as const;
