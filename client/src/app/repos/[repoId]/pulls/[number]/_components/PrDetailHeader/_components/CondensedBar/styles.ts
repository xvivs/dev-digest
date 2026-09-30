import type { CSSProperties } from "react";
import {
  CONDENSED_BAR_HEIGHT,
  CONDENSED_BAR_MS,
  CONDENSED_BAR_TABS_ROW,
  CONDENSED_BAR_TITLE_ROW,
} from "@/app/repos/[repoId]/pulls/[number]/constants";

export const s = {
  /** Zero-height sticky box: pinned to the top of <main> but it takes no flow
   *  space, so showing or hiding the bar can never shift the content. */
  anchor: {
    position: "sticky",
    top: 0,
    height: 0,
    zIndex: 5,
  } satisfies CSSProperties,
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CONDENSED_BAR_HEIGHT,
    boxSizing: "border-box",
    background: "var(--bg-primary)",
    boxShadow: "0 1px 0 var(--border)",
    padding: "0 14px",
    transform: "translateY(0)",
    opacity: 1,
    transition: `transform ${CONDENSED_BAR_MS}ms ease-out, opacity ${CONDENSED_BAR_MS}ms ease-out`,
  } satisfies CSSProperties,
  hidden: {
    transform: "translateY(-100%)",
    opacity: 0,
    pointerEvents: "none",
  } satisfies CSSProperties,
  instant: { transition: "none" } satisfies CSSProperties,
  row: {
    height: CONDENSED_BAR_TITLE_ROW,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  titleButton: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  number: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    color: "var(--text-muted)",
    fontWeight: 500,
  } satisfies CSSProperties,
  title: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tabs: {
    height: CONDENSED_BAR_TABS_ROW,
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
