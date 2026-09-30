import type { CSSProperties } from "react";
import { HEADER_COLLAPSE_MS } from "@/app/repos/[repoId]/pulls/[number]/constants";

export const s = {
  root: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    background: "var(--bg-primary)",
    borderBottom: "1px solid var(--border)",
    padding: "18px 32px 0",
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 18,
  } satisfies CSSProperties,
  titleCol: {
    flex: "1 1 240px",
    minWidth: 0,
  } satisfies CSSProperties,
  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: 12,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  prNumber: {
    fontSize: 18,
    color: "var(--text-muted)",
    fontWeight: 500,
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginTop: 10,
    marginBottom: 14,
    fontSize: 13,
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  authorChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  branchChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  branchMono: {
    fontSize: 12,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  staleBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  mutedIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  additions: { color: "var(--code-add-text)" } satisfies CSSProperties,
  deletions: { color: "var(--code-del-text)" } satisfies CSSProperties,
  warnIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,

  /* Mobile (< md) variants, applied on top of the desktop styles above. */
  rootMobile: { padding: "10px 14px 0" } satisfies CSSProperties,
  rootCompact: { padding: "6px 14px 0" } satisfies CSSProperties,
  titleRowMobile: {
    flexWrap: "nowrap",
    gap: 10,
  } satisfies CSSProperties,
  titleRowCompact: { alignItems: "center" } satisfies CSSProperties,
  h1Mobile: {
    fontSize: 16,
    lineHeight: 1.3,
    gap: 8,
    alignItems: "baseline",
  } satisfies CSSProperties,
  h1Compact: { fontSize: 14, alignItems: "center" } satisfies CSSProperties,
  prNumberMobile: { fontSize: 14, flexShrink: 0 } satisfies CSSProperties,
  /** Title clamped to two lines. */
  titleClamp: {
    minWidth: 0,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  compactTitleButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    width: "100%",
    padding: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    letterSpacing: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  /** Title on one line with an ellipsis. */
  titleOneLine: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  metaMobile: {
    gap: "4px 10px",
    marginTop: 0,
    marginBottom: 0,
    padding: "6px 0 10px",
    fontSize: 12,
  } satisfies CSSProperties,
  branchMonoMobile: {
    fontSize: 11.5,
    maxWidth: 120,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  actionsMobile: { gap: 6, alignItems: "center" } satisfies CSSProperties,
  /** Grid 1fr -> 0fr collapse: height:auto does not interpolate (INSIGHTS). */
  collapsible: {
    display: "grid",
    gridTemplateRows: "1fr",
    opacity: 1,
    transition: `grid-template-rows ${HEADER_COLLAPSE_MS}ms ease-out, opacity ${HEADER_COLLAPSE_MS}ms ease-out`,
  } satisfies CSSProperties,
  collapsibleClosed: { gridTemplateRows: "0fr", opacity: 0 } satisfies CSSProperties,
  collapsibleInner: { overflow: "hidden", minHeight: 0 } satisfies CSSProperties,
  tabsScroll: {
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
  } satisfies CSSProperties,
} as const;
