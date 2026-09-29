import type { CSSProperties } from "react";

const cell = { padding: "8px 10px", borderBottom: "1px solid var(--border)", textAlign: "left" } as const satisfies CSSProperties;

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { maxWidth: 880, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  caption: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  group: {
    display: "inline-flex",
    flexShrink: 0,
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  /** Dimmed while a window switch is loading (previous numbers stay visible). */
  sections: (stale: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 16,
    opacity: stale ? 0.6 : 1,
    transition: "opacity .15s",
  }),
  metrics: { display: "flex", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  sectionCaption: { fontSize: 13, color: "var(--text-secondary)", margin: "-6px 0 12px" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", margin: "12px 0 0" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 14 } satisfies CSSProperties,
  th: { ...cell, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  thNum: { ...cell, fontWeight: 600, color: "var(--text-secondary)", textAlign: "right" } satisfies CSSProperties,
  td: cell satisfies CSSProperties,
  tdNum: { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
  agentLink: { color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" } satisfies CSSProperties,
  versionCell: { display: "inline-flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  current: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;

/** One button of the 7d/30d/90d group (same look as the Versions diff toggle). */
export function windowButton(active: boolean): CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12.5,
    border: "none",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: active ? 600 : 500,
    cursor: active ? "default" : "pointer",
  };
}
