import type { CSSProperties } from "react";

/** Co-located styles for CaseEditorModal. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 18, padding: "4px 0" } satisfies CSSProperties,
  field: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  input: {
    padding: "9px 10px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 14,
  } satisfies CSSProperties,
  textarea: {
    width: "100%",
    resize: "vertical",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  tabBody: { paddingTop: 10 } satisfies CSSProperties,
  keep: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 7,
    padding: "8px 10px",
    margin: 0,
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
