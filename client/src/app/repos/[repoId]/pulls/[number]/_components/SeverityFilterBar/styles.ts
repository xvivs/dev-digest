import type { CSSProperties } from "react";

/** Co-located styles for SeverityFilterBar. */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 7,
  } satisfies CSSProperties,
  counts: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  separator: {
    color: "var(--text-muted)",
    fontWeight: 400,
  } satisfies CSSProperties,
  filters: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /**
   * Visually a `Chip` from `@devdigest/ui`, re-implemented locally because that
   * primitive supports neither `disabled` nor `aria-pressed` and `vendor/ui` is
   * do-not-touch. Active state borrows the severity's own colour instead of the
   * generic accent so the selected filter reads as "this severity".
   */
  chip: (o: {
    active: boolean;
    disabled: boolean;
    hovered: boolean;
    color: string;
  }): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 12px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    transition: "all .12s",
    border: `1px solid ${o.active ? o.color : "var(--border)"}`,
    background: o.active || (o.hovered && !o.disabled) ? "var(--bg-hover)" : "transparent",
    color: o.disabled
      ? "var(--text-muted)"
      : o.active
        ? o.color
        : o.hovered
          ? "var(--text-primary)"
          : "var(--text-secondary)",
    cursor: o.disabled ? "not-allowed" : "pointer",
    opacity: o.disabled ? 0.45 : 1,
  }),
} as const;
