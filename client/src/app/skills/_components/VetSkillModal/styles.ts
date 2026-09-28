import type { CSSProperties } from "react";

/** Co-located styles for VetSkillModal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  copy: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  warning: {
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 10px",
    borderRadius: 6,
  } satisfies CSSProperties,
  sourceCaption: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  source: {
    margin: 0,
    maxHeight: 320,
    overflow: "auto",
    padding: 12,
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  invisibleMark: {
    background: "var(--warn-bg)",
    color: "var(--warn)",
    borderRadius: 3,
    padding: "0 2px",
  } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
