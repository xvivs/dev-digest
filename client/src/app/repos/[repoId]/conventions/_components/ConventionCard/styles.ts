import type { CSSProperties } from "react";

/** Co-located styles for ConventionCard. */
export const s = {
  card: (accent: string): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    columnGap: 20,
    padding: "16px 18px",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accent}`,
    borderRadius: 10,
    background: "var(--bg-elevated)",
  }),
  main: { minWidth: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  rule: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.4,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 } satisfies CSSProperties,
  skillBadgeLink: { textDecoration: "none" } satisfies CSSProperties,
  evidenceList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  confidenceRow: { display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceBar: { width: 110 } satisfies CSSProperties,
  pct: { fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: { display: "flex", flexDirection: "column", gap: 8, width: 160 } satisfies CSSProperties,
} as const;
