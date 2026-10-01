import type { CSSProperties } from "react";
import { s as shared } from "../../styles";

/** Max height (px) of the tree/graph body before it scrolls; matches the 360px used by other in-card scroll areas. */
export const BLAST_BODY_MAX_HEIGHT = 360;

export const s = {
  statsRow: { display: "flex", alignItems: "center", flexWrap: "nowrap", gap: 12, marginBottom: 14 } satisfies CSSProperties,
  stats: { flex: "1 1 auto", minWidth: 0, display: "flex", flexWrap: "wrap", columnGap: 12, rowGap: 4, alignItems: "center" } satisfies CSSProperties,
  stat: { display: "inline-flex", alignItems: "center", gap: 5 } satisfies CSSProperties,
  statIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  statValue: { fontSize: 12, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  statLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    flexShrink: 0,
    marginLeft: "auto",
    padding: 2,
    gap: 2,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toggleBtn: (active: boolean): CSSProperties => ({
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "capitalize",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),
  notice: { ...shared.notice, marginBottom: 12 } satisfies CSSProperties,
  truncated: { ...shared.muted, marginBottom: 10 } satisfies CSSProperties,
  basedOn: { ...shared.muted, marginTop: 12 } satisfies CSSProperties,
} as const;
