/** CSS variable carrying the measured height of the sticky PR header. Written
 *  by PrDetailContent (useStickyOffset), read by DiffTab's sticky group headers. */
export const PR_HEADER_OFFSET_VAR = "--pr-header-h";

/** Mobile = below the `md` breakpoint, the exact complement of the `dd-*-below-md`
 *  utilities (ADR 0024). The only JS use is the behaviour gate: which header
 *  variant is sticky and whether the condensing observer runs. */
export const MOBILE_QUERY = "(max-width: 767px)";

/** Mobile PR header layouts: "mobile" = the full header scrolls with the content,
 *  "condensed" = it has scrolled away and the fixed-height bar is pinned. */
export type HeaderLayout = "desktop" | "mobile" | "condensed";

/** Fixed height (px) of the condensed bar: title row + tabs row. It is also the
 *  mobile --pr-header-h, so Smart Diff groups stick right under it (no measuring). */
export const CONDENSED_BAR_TITLE_ROW = 42;
export const CONDENSED_BAR_TABS_ROW = 46;
export const CONDENSED_BAR_HEIGHT = CONDENSED_BAR_TITLE_ROW + CONDENSED_BAR_TABS_ROW;
export const CONDENSED_BAR_MS = 180;
