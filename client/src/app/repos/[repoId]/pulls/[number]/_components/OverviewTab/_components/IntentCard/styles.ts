import type { CSSProperties } from "react";
import { s as shared } from "../../styles";

export const s = {
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  /** Low-confidence intent: the card stays, but visually recedes. */
  lowCard: { ...shared.card, opacity: 0.8 } satisfies CSSProperties,
  quote: {
    margin: "0 0 14px",
    padding: "4px 0 4px 14px",
    borderLeft: "3px solid var(--accent)",
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  scopes: { display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 } satisfies CSSProperties,
  scope: { flex: "1 1 180px", minWidth: 0 } satisfies CSSProperties,
  meta: { marginTop: 12 } satisfies CSSProperties,
  metaLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  item: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, overflowWrap: "anywhere" } satisfies CSSProperties,
  cost: { marginTop: 14 } satisfies CSSProperties,
} as const;
