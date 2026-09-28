import type { CSSProperties } from "react";

/** Co-located styles for RunHistory. */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: (hovered: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: hovered ? "var(--bg-hover)" : "var(--bg-elevated)",
    textAlign: "left",
    transition: "background .12s",
    cursor: "pointer",
  }),
  /** Commits are markers, not actions — lighter (dashed, transparent) so they
   *  read as separators between the runs they sit chronologically between. */
  commitRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px dashed var(--border)",
    background: "transparent",
  } satisfies CSSProperties,
  commitIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  /** Accent-tinted like every other code reference in the app — the sha is
   *  the one token in this row that identifies a commit. */
  commitSha: { fontSize: 12, color: "var(--accent-text)", flexShrink: 0 } satisfies CSSProperties,
  commitMessage: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  commitMeta: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  main: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleLine: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  agentButton: (clickable: boolean): CSSProperties => ({
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    fontWeight: 600,
    color: "var(--text-primary)",
    cursor: clickable ? "pointer" : "default",
    // No underline: the design keeps the agent name as plain text. `title` +
    // the pointer carry the affordance instead.
    textDecoration: "none",
  }),
  model: { fontSize: 12, fontWeight: 400, color: "var(--text-muted)" } satisfies CSSProperties,
  error: {
    fontSize: 12,
    color: "var(--crit)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingsLine: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  side: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  cost: { color: "var(--text-secondary)" } satisfies CSSProperties,
  /** The two trailing actions travel together, spaced wider than the row's gap —
   *  roughly one glyph-width apart, so "open trace" and "delete" never read as
   *  a single control the way a tight pair of borderless icons would. */
  actions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 16,
    marginLeft: 6,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
