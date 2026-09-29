import type { CSSProperties } from "react";

/** Co-located styles for ScanHeader. */
export const s = {
  head: { display: "flex", alignItems: "flex-start", gap: 16 } satisfies CSSProperties,
  titleWrap: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  title: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repo: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,
  olderNote: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
    gap: "12px 24px",
    margin: "18px 0 0",
    padding: "12px 16px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  stat: { display: "flex", flexDirection: "column", gap: 2, margin: 0, minWidth: 0 } satisfies CSSProperties,
  statLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statValue: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" } satisfies CSSProperties,
} as const;
