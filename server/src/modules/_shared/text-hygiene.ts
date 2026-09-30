/**
 * Input hygiene shared by every feature that writes text a model will read
 * (skills, conventions). Pure.
 *
 * ADR 0012: Unicode tag characters (tag-based prompt injection), bidi overrides
 * (visually reorder text to hide intent), and zero-width characters, word
 * joiners, direction marks and soft hyphens (invisible smuggling) are rejected
 * outright. Mirrored in client/src/app/skills/helpers.ts (INVISIBLE_CHAR_SOURCE)
 * — keep in sync.
 */
export const INVISIBLE_CHARS_PATTERN =
  /[\u{E0000}-\u{E007F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200B}-\u{200F}\u{2060}-\u{2064}\u{061C}\u{180E}\u{00AD}\u{FEFF}]/u;

export function containsInvisibleChars(body: string): boolean {
  return INVISIBLE_CHARS_PATTERN.test(body);
}
