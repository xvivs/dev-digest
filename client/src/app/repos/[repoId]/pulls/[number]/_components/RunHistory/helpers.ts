/**
 * Timeline-specific formatting. Separate from RunTraceDrawer/helpers.ts's
 * `formatTokens` on purpose — that one renders the sidebar's "12k→1.5k" shape;
 * the timeline row needs a single running total, "9,119 tok".
 */

/** Total tokens for the timeline row, e.g. "9,119 tok". Null when the run has no token counts. */
export function formatTokenTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null && tokensOut == null) return null;
  const total = (tokensIn ?? 0) + (tokensOut ?? 0);
  return `${new Intl.NumberFormat("en-US").format(total)} tok`;
}
