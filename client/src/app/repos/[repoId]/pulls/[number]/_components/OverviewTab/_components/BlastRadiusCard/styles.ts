import type { CSSProperties } from "react";
import { s as shared } from "../../styles";

export const s = {
  toggle: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  toggleBtn: (active: boolean): CSSProperties => ({
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-muted)",
  }),
  stats: { display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 14 } satisfies CSSProperties,
  stat: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  statValue: { fontSize: 20, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  notice: { ...shared.notice, marginBottom: 12 } satisfies CSSProperties,
  truncated: { ...shared.muted, marginBottom: 10 } satisfies CSSProperties,
  basedOn: { ...shared.muted, marginTop: 12 } satisfies CSSProperties,
} as const;
