import type { CSSProperties } from "react";
import { PANEL_GAP, PANEL_WIDTH, PANEL_Z } from "./constants";
import type { PanelPosition } from "./helpers";

/** Co-located styles for FindingsPopover. */
export const s = {
  anchor: { display: "inline-flex", alignItems: "center" } satisfies CSSProperties,

  /**
   * Positioning shell + the mouse bridge.
   *
   * The `PANEL_GAP` between anchor and card is dead space the cursor would have
   * to cross with no element under it, which fires `mouseout` on the anchor. So
   * the shell reclaims that strip as padding: below-placement pads the top and
   * pulls itself back up by the same amount (keeping the card exactly where
   * `clampToViewport` put it), above-placement simply grows downward.
   *
   * `pos === null` means "rendered but not yet measured" — one frame at 0,0 at
   * zero opacity, never visible.
   */
  shell: (pos: PanelPosition | null): CSSProperties => ({
    position: "fixed",
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    width: PANEL_WIDTH,
    maxWidth: "calc(100vw - 16px)",
    zIndex: PANEL_Z,
    opacity: pos ? 1 : 0,
    pointerEvents: pos ? "auto" : "none",
    ...(pos?.placement === "top"
      ? { paddingBottom: PANEL_GAP }
      : { paddingTop: PANEL_GAP, marginTop: -PANEL_GAP }),
  }),

  card: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: "10px 12px 12px",
    animation: "ddpop .12s ease",
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  headerIcon: { flexShrink: 0 } satisfies CSSProperties,

  headerText: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  } satisfies CSSProperties,

  status: {
    marginTop: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  list: { marginTop: 4 } satisfies CSSProperties,

  item: (first: boolean): CSSProperties => ({
    paddingTop: 12,
    paddingBottom: 4,
    borderTop: first ? "none" : "1px solid var(--border)",
  }),

  /** Wraps: a long finding title pushes the category tag onto the next line. */
  titleRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,

  findingTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
  } satisfies CSSProperties,

  /**
   * A plain span, not `MonoLink`: without an `href` MonoLink renders a
   * <button>, and a tooltip must contain no interactive elements — it is not
   * reachable by keyboard or pointer once the cursor leaves the anchor.
   */
  location: {
    fontSize: 13,
    color: "var(--accent-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** Plain text, clamped to two lines — hence no <Markdown>, which emits blocks. */
  rationale: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
  } satisfies CSSProperties,

  more: {
    marginTop: 10,
    paddingTop: 9,
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
