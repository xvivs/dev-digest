import type { CSSProperties } from "react";

/** Co-located styles for SuccessPanel. */
export const s = {
  wrap: { padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 } satisfies CSSProperties,
  badge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "var(--ok-bg)",
    color: "var(--ok)",
  } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  copy: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 } satisfies CSSProperties,
  actions: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 } satisfies CSSProperties,
  link: (primary: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 13px",
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 6,
    textDecoration: "none",
    border: "1px solid " + (primary ? "var(--accent)" : "var(--border-strong)"),
    background: primary ? "var(--accent)" : "var(--bg-elevated)",
    color: primary ? "var(--on-accent)" : "var(--text-primary)",
  }),
} as const;
