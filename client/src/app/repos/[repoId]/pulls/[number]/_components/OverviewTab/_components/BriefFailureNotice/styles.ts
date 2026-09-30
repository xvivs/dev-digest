import type { CSSProperties } from "react";

export const s = {
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
} as const;
