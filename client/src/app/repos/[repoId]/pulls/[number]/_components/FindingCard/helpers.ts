/* Pure helpers for FindingCard. No React. */

/** Text made only of whitespace and the punctuation models emit as an empty-field stand-in. */
const PLACEHOLDER_RE = /^[\s:.,\-–—…*_]*$/;

/**
 * True when `text` is absent or only placeholder punctuation (":", "-", "...").
 * Models emit that for an optional field; it is truthy but has nothing to show.
 * Anything else renders, including code-only suggestions like "});".
 */
export function isPlaceholderSuggestion(text: string | null | undefined): boolean {
  return !text || PLACEHOLDER_RE.test(text);
}
