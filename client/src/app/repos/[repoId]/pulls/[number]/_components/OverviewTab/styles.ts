import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))",
    gap: 16,
  } satisfies CSSProperties,
  col: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "var(--card-pad, 16px)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** Root of a block inside a shared card: min-width guard only, the card owns the chrome. */
  block: { minWidth: 0 } satisfies CSSProperties,
  divider: {
    border: 0,
    borderTop: "1px solid var(--border)",
    margin: "16px 0",
  } satisfies CSSProperties,
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
  muted: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  mono: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  code: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "0.92em",
    padding: "1px 5px",
    borderRadius: 4,
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
} as const;
