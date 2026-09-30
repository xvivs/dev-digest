/* tokens.ts — client-side token estimate for text that reaches an agent prompt. */

/**
 * SPEC-02 D4: `ceil(chars / 4)` — a pure, dependency-free estimate, duplicated
 * client-side (the server/reviewer-core copy is the one that gates the 24 KB
 * budget). It undercounts Cyrillic/CJK text; the UI always prefixes it with "≈".
 */
export function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}
