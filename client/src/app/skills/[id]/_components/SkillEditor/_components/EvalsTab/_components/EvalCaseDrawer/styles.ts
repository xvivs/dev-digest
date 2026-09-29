import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseDrawer; section styling follows RunTraceDrawer (bordered elevated blocks). */
export const s = {
  title: { fontSize: 15 } satisfies CSSProperties,
  subtitleRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" } satisfies CSSProperties,
  statusIcon: (color: string): CSSProperties => ({ display: "inline-flex", color }),
  chip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, borderRadius: 5, padding: "2px 8px" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  warn: { fontSize: 12.5, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 7, padding: "8px 12px", marginBottom: 14, lineHeight: 1.5 } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", padding: "4px 0 14px" } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, alignItems: "center" } satisfies CSSProperties,
  footerSpacer: { flex: 1 } satisfies CSSProperties,
  stats: { display: "flex", gap: 10, marginBottom: 12 } satisfies CSSProperties,
  stat: { flex: 1, padding: "10px 12px", borderRadius: 7, background: "var(--bg-surface)", border: "1px solid var(--border)" } satisfies CSSProperties,
  statLabel: { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 } satisfies CSSProperties,
  statVal: { fontSize: 16, fontWeight: 700, marginTop: 4 } satisfies CSSProperties,
  arms: { display: "flex", gap: 16, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap" } satisfies CSSProperties,
  armStrong: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  groupTitle: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 4px" } satisfies CSSProperties,
  finding: { display: "flex", flexDirection: "column", gap: 2, padding: "8px 0", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  findingTitle: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  findingMeta: { fontSize: 11.5, color: "var(--text-muted)", display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  group: { marginBottom: 10 } satisfies CSSProperties,
} as const;
