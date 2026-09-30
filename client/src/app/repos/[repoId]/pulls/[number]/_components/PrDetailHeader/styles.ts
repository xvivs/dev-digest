import type { CSSProperties } from "react";

export const s = {
  root: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    background: "var(--bg-primary)",
    borderBottom: "1px solid var(--border)",
    padding: "var(--dd-prh-pad)",
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "var(--dd-prh-row-gap)",
  } satisfies CSSProperties,
  titleCol: {
    flex: "1 1 var(--dd-prh-title-basis)",
    minWidth: 0,
  } satisfies CSSProperties,
  h1: {
    outline: "none",
    fontSize: "var(--dd-prh-h1-size)",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: "var(--dd-prh-h1-gap)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  prNumber: {
    fontSize: "var(--dd-prh-num-size)",
    color: "var(--text-muted)",
    fontWeight: 500,
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    gap: "var(--dd-prh-meta-gap)",
    margin: "var(--dd-prh-meta-margin)",
    padding: "var(--dd-prh-meta-pad)",
    fontSize: "var(--dd-prh-meta-size)",
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
    fontSize: "var(--dd-prh-branch-size)",
    maxWidth: "var(--dd-prh-branch-max)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "var(--dd-prh-actions-gap)",
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
  /** Two-line clamp below md (--dd-prh-title-lines), unclamped above. */
  titleText: {
    minWidth: 0,
    display: "-webkit-box",
    WebkitLineClamp: "var(--dd-prh-title-lines)" as unknown as number,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  /** Mobile: the full header scrolls away with the content (the condensed bar pins instead). */
  rootScrolling: { position: "static" } satisfies CSSProperties,
  /** Mobile: tabs scroll sideways instead of wrapping. */
  tabsScroll: { overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none", whiteSpace: "nowrap" } satisfies CSSProperties,
  /** 1px at the header's bottom edge, net zero flow height; the condensing observer watches it. */
  sentinel: { height: 1, marginTop: -1, pointerEvents: "none" } satisfies CSSProperties,
  mutedIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  additions: { color: "var(--code-add-text)" } satisfies CSSProperties,
  deletions: { color: "var(--code-del-text)" } satisfies CSSProperties,
  warnIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
} as const;
