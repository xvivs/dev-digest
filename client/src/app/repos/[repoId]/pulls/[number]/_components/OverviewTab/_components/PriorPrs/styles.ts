import type { CSSProperties } from "react";
import { s as shared } from "../../styles";

export const s = {
  icon: { color: "var(--text-muted)" } satisfies CSSProperties,
  box: { border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-surface)" } satisfies CSSProperties,
  header: { gap: 8, padding: "10px 12px" } satisfies CSSProperties,
  heading: { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  chev: { marginLeft: "auto", display: "inline-flex" } satisfies CSSProperties,
  body: { padding: "0 12px 12px" } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  row: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap", minWidth: 0 } satisfies CSSProperties,
  number: { ...shared.mono, flexShrink: 0 } satisfies CSSProperties,
  path: { ...shared.mono, display: "block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  overlapFiles: { display: "flex", flexDirection: "column", gap: 2, width: "100%", minWidth: 0 } satisfies CSSProperties,
  title: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", } satisfies CSSProperties,
  overlap: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } satisfies CSSProperties,
} as const;
