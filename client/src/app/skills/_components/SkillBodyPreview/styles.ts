import type { CSSProperties } from "react";

/** Co-located styles for SkillBodyPreview. */
export const s = {
  caption: { fontSize: 13, color: "var(--text-muted)", marginBottom: 14 } satisfies CSSProperties,
  modeBar: { marginBottom: 16 } satisfies CSSProperties,
  warning: {
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 10px",
    borderRadius: 6,
    marginBottom: 12,
  } satisfies CSSProperties,
  rendered: {
    padding: "18px 20px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13.5,
    lineHeight: 1.65,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  source: {
    margin: 0,
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
} as const;
