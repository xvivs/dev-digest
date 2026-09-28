import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab + SkillRow. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, marginRight: "auto" } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 } satisfies CSSProperties,
  filter: { width: 220 } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  saveError: {
    fontSize: 12.5,
    color: "var(--crit)",
    background: "var(--crit-bg, rgba(220,38,38,.08))",
    border: "1px solid var(--crit)",
    borderRadius: 6,
    padding: "8px 10px",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  empty: { padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,

  // ---- SkillRow ----
  row: (muted: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderBottom: "1px solid var(--border)",
    opacity: muted ? 0.55 : 1,
  }),
  handle: { display: "flex", color: "var(--text-muted)", cursor: "grab", flexShrink: 0 } satisfies CSSProperties,
  handleInert: { display: "flex", color: "var(--border-strong)", flexShrink: 0 } satisfies CSSProperties,
  name: { fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  mutedNote: { fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  order: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,
  /** Visible only to assistive tech — the checkbox's only accessible name. */
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
