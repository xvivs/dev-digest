import type { CSSProperties } from "react";
import { s as shared } from "../../../../styles";

export const s = {
  wrap: { marginTop: 14 } satisfies CSSProperties,
  header: { gap: 6, padding: "2px 0", color: "var(--text-muted)", fontSize: 12, fontWeight: 600 } satisfies CSSProperties,
  body: { paddingTop: 10 } satisfies CSSProperties,
  meta: { marginTop: 10 } satisfies CSSProperties,
  costLine: { ...shared.muted, marginTop: 10 } satisfies CSSProperties,
  metaLabel: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
} as const;
