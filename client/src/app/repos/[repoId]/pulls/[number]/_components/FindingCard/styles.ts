import type { CSSProperties } from "react";
import { BADGE_COLUMN_WIDTH, HEADER_GAP } from "./constants";

/** Co-located styles for FindingCard (extracted from inline styles). */
export const s = {
  card: (focused: boolean, sevColor: string, muted: boolean): CSSProperties => ({
    borderRadius: 8,
    // All-longhand (never mix `border` shorthand with `borderLeft` — React warns
    // about updating shorthand + non-shorthand on the same rerender).
    borderStyle: "solid",
    // Per-side longhands only. `borderColor`/`borderWidth` are themselves
    // 4-side shorthands, and React warns when a shorthand and its longhand
    // (`borderLeftColor`) both change between renders — which is exactly what
    // happens when `focused` flips.
    borderTopColor: focused ? sevColor : "var(--border)",
    borderRightColor: focused ? sevColor : "var(--border)",
    borderBottomColor: focused ? sevColor : "var(--border)",
    borderLeftColor: sevColor,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    opacity: muted ? 0.6 : 1,
    transition: "opacity .2s, border-color .12s, box-shadow .12s",
    boxShadow: focused ? "0 0 0 1px " + sevColor : "none",
  }),
  /** Disclosure header row. Wraps so `actions` (the meta row) drops under the
   *  title; `rowGap: 0` keeps the old 5px title→meta spacing (metaRow.marginTop). */
  header: {
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: HEADER_GAP,
    rowGap: 0,
    padding: "14px 16px",
  } satisfies CSSProperties,
  // alignSelf: the toggle button centres its children; the old header was top-aligned.
  badgeWrap: {
    paddingTop: 1,
    width: BADGE_COLUMN_WIDTH,
    flexShrink: 0,
    alignSelf: "flex-start",
  } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (muted: boolean, dismissed: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  acceptedTag: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  dismissedTag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Rendered in the Disclosure's `actions`: a full-width line indented past the badge. */
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
    flexBasis: "100%",
    paddingLeft: BADGE_COLUMN_WIDTH + HEADER_GAP,
  } satisfies CSSProperties,
  chevron: { marginTop: 2, alignSelf: "flex-start" } satisfies CSSProperties,
  body: { padding: "14px 16px 16px", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  trifectaWrap: { marginBottom: 14 } satisfies CSSProperties,
  prose: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  suggestionWrap: { marginTop: 14 } satisfies CSSProperties,
  suggestionLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: 8,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  composer: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  composerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
