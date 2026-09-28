import type { CSSProperties } from "react";
import type { DiffLine } from "./helpers";

/** Co-located styles for VersionDiff. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toolbar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  heading: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 } satisfies CSSProperties,
  group: { display: "inline-flex", border: "1px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontWeight: 600,
    color: "var(--text-secondary)",
    padding: "6px 8px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top", wordBreak: "break-word" } satisfies CSSProperties,
  tdOld: { color: "var(--crit)" } satisfies CSSProperties,
  tdNew: { color: "var(--ok)" } satisfies CSSProperties,
  bodyHead: { display: "flex", alignItems: "baseline", gap: 10 } satisfies CSSProperties,
  lines: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "auto",
    maxHeight: 480,
    fontSize: 12.5,
    lineHeight: 1.55,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  lineNo: {
    width: 40,
    flexShrink: 0,
    textAlign: "right",
    paddingRight: 8,
    color: "var(--text-muted)",
    userSelect: "none",
  } satisfies CSSProperties,
  sign: { width: 18, flexShrink: 0, textAlign: "center", userSelect: "none" } satisfies CSSProperties,
  text: { whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, paddingRight: 8 } satisfies CSSProperties,
} as const;

/** Toggle button inside the "vs previous / vs current" group. */
export function toggleFor(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 12.5,
    border: "none",
    background: active ? "var(--bg-hover)" : "transparent",
    color: disabled ? "var(--text-muted)" : active ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: active ? 600 : 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

const LINE_BG: Record<DiffLine["kind"], string> = { add: "var(--ok-bg)", del: "var(--crit-bg)", ctx: "transparent" };
const SIGN_COLOR: Record<DiffLine["kind"], string> = { add: "var(--ok)", del: "var(--crit)", ctx: "var(--text-muted)" };

export function lineRowFor(kind: DiffLine["kind"]): CSSProperties {
  return { display: "flex", background: LINE_BG[kind] };
}

export function signFor(kind: DiffLine["kind"]): CSSProperties {
  return { ...s.sign, color: SIGN_COLOR[kind] };
}
