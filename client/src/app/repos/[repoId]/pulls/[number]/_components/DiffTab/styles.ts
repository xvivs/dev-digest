import type { CSSProperties } from "react";

export const s = {
  headerRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  } satisfies CSSProperties,
  summary: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  add: { color: "var(--code-add-text)" } satisfies CSSProperties,
  del: { color: "var(--code-del-text)" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", marginBottom: 14 } satisfies CSSProperties,
  /** Findings on paths that are not in the PR: same look as the viewer's end-of-file blocks. */
  unmatchedWrap: {
    borderTop: "1px solid var(--border)",
    marginTop: 18,
    paddingTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  unmatchedTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
