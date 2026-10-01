import type { CSSProperties } from "react";
import { s as shared } from "../../styles";

export const s = {
  ruleOnly: { ...shared.notice, marginBottom: 12 } satisfies CSSProperties,
  footer: { ...shared.muted, display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 } satisfies CSSProperties,
  pills: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  pill: (active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 6,
    border: `1px solid ${active ? "var(--text-muted)" : "var(--border)"}`,
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    maxWidth: "100%",
    textAlign: "left",
    overflowWrap: "anywhere",
  }),
  /** Severity colour lives on the icon only; the word itself is visually hidden. */
  pillIcon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  detail: {
    marginTop: 12,
    padding: 12,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  explanation: {
    margin: "10px 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  refs: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
} as const;
