import type { CSSProperties } from "react";

/** Co-located styles for SeverityIcons. */
export const s = {
  row: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,

  /**
   * One severity cell. Renders as a <button> or a <span> depending on
   * `onSelect`, so every button-ism has to be neutralised here (no border, no
   * background, inherit the caller's font) — the two branches must be pixel
   * identical, otherwise the PR list and the popover anchor drift apart.
   */
  item: (interactive: boolean, active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 3px",
    margin: "-1px -3px",
    border: "none",
    borderRadius: 4,
    background: active ? "var(--bg-hover)" : "transparent",
    color: "inherit",
    font: "inherit",
    lineHeight: 1,
    cursor: interactive ? "pointer" : "default",
  }),

  icon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),

  /**
   * The underline is the affordance: it is the only thing that tells the user
   * this number is hoverable/clickable, since the cell carries no button chrome.
   */
  count: (size: number): CSSProperties => ({
    fontSize: size,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  }),
} as const;
