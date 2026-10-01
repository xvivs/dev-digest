import type { CSSProperties } from "react";

export const s = {
  col: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 } satisfies CSSProperties,
  /** Single-row stand-in for the brief when runs exist but none has finished a review. */
  briefEmpty: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  briefEmptyTitle: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  /** Cost line under the score: $ icon, amount in primary text, tokens muted. */
  cost: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 } satisfies CSSProperties,
  costIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  costAmount: { color: "var(--text-primary)", fontWeight: 500 } satisfies CSSProperties,
  /** Label row above the brief: icon + uppercase muted caption. */
  briefLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
