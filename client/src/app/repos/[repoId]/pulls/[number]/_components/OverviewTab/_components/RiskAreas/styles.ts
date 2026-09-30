import type { CSSProperties } from "react";
import { s as shared } from "../../styles";

export const s = {
  ruleOnly: { ...shared.notice, marginBottom: 12 } satisfies CSSProperties,
  footer: { ...shared.muted, display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 } satisfies CSSProperties,
  pills: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  pill: (color: string, bg: string, active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 99,
    border: `1px solid ${active ? color : "var(--border)"}`,
    background: bg,
    color,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    maxWidth: "100%",
    textAlign: "left",
    overflowWrap: "anywhere",
  }),
  sev: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    opacity: 0.85,
  } satisfies CSSProperties,
  detail: {
    marginTop: 12,
    padding: 14,
    borderRadius: 8,
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
