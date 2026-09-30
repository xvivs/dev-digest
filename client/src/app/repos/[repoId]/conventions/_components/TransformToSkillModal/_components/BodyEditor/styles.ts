import type { CSSProperties } from "react";

/** Co-located styles for BodyEditor. */
export const s = {
  frame: {
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  file: { fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  editorWrap: { padding: 10 } satisfies CSSProperties,
  warning: {
    margin: "10px 10px 0",
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 10px",
    borderRadius: 6,
  } satisfies CSSProperties,
  raw: {
    margin: 0,
    padding: 14,
    maxHeight: 360,
    overflow: "auto",
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
