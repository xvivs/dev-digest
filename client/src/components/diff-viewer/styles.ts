import type { CSSProperties } from "react";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  /** Content of the Disclosure toggle button: the whole row is the hit area. */
  fileHeader: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 11px",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 12.5,
    fontWeight: 500,
    flex: "0 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 11.5 } satisfies CSSProperties,
  /** Right cluster of the file header: comment counter, then +N −M. */
  statCluster: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  /** Agent-finding marker right after the path (severity lives on the lines). */
  findingDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    background: "var(--crit)",
    flexShrink: 0,
  } satisfies CSSProperties,
  commentCount: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "6px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 16px",
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    position: "relative",
    width: 44,
    textAlign: "right",
    padding: "0 8px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 10,
  } satisfies CSSProperties,
} as const;

/**
 * Inline-comment styles (layout only; cards, inputs and buttons reuse
 * @devdigest/ui).
 */
export const cs = {
  rowWrap: { position: "relative" } satisfies CSSProperties,
  addBtn: {
    position: "absolute",
    left: 2,
    top: "50%",
    transform: "translateY(-50%)",
    width: 18,
    height: 18,
    borderRadius: 5,
    border: "none",
    background: "var(--accent)",
    // No text-on-accent token exists yet; the fallback keeps today's white.
    color: "var(--on-accent, #fff)",
    fontSize: 14,
    lineHeight: "18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    zIndex: 1,
    boxShadow: "0 1px 3px rgba(0,0,0,.35)",
  } satisfies CSSProperties,
  /** Indented rail for threads/composer, aligned under the code (past gutter). */
  thread: {
    margin: "6px 14px 8px 58px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  user: { fontWeight: 600, fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  time: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  ghLink: {
    fontSize: 12,
    color: "var(--text-muted)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
  mdBody: {
    fontSize: 13,
    lineHeight: "19px",
    color: "var(--text-secondary)",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  composerActions: { display: "flex", gap: 8, alignItems: "center", marginTop: 8 } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  outdatedWrap: {
    borderTop: "1px solid var(--border)",
    margin: "4px 14px 4px 58px",
    paddingTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  outdatedTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent). */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return {
    position: "relative",
    display: "flex",
    alignItems: "stretch",
    fontSize: 12,
    lineHeight: "20px",
    background,
  };
}

/** 3px severity stripe on a line covered by an active finding; the row keeps its add/del background. */
export function lineStripeFor(color: string): CSSProperties {
  return { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color };
}

/** Right-aligned lowercase severity word on a finding's start line. */
export function lineLabelFor(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingRight: 10,
    fontSize: 10.5,
    fontWeight: 600,
    color,
    flexShrink: 0,
  };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
