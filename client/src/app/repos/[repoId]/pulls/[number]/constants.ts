/** CSS variable carrying the measured height of the sticky PR header. Written
 *  by PrDetailContent (useStickyOffset), read by DiffTab's sticky group headers. */
export const PR_HEADER_OFFSET_VAR = "--pr-header-h";

/** Same header height, frozen while the header is compact (mobile collapse): the
 *  body reserves `full - live` above itself so collapsing never shortens the
 *  scroll flow. Written by useStickyOffset next to PR_HEADER_OFFSET_VAR. */
export const PR_HEADER_FULL_OFFSET_VAR = "--pr-header-full-h";

/** Mobile = below the `md` breakpoint, the exact complement of the `dd-*-below-md`
 *  utilities (ADR 0024). */
export const MOBILE_QUERY = "(max-width: 767px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Collapse hysteresis (px of <main> scrollTop): collapse once scrolled past
 *  COLLAPSE_AT, expand again only below EXPAND_AT, so the state cannot flicker
 *  around a single threshold. */
export const HEADER_COLLAPSE_AT = 120;
export const HEADER_EXPAND_AT = 40;

/** Meta-row collapse animation. Reduced motion is zeroed by the global rule in styles.css. */
export const HEADER_COLLAPSE_MS = 200;
