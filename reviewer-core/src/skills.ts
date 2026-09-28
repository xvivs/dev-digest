/**
 * Skill inputs for prompt assembly (SPEC-02). The caller resolves which skills
 * are effective (enabled, linked, vetted) and passes them in prompt order; this
 * package only renders them. Pure — no I/O.
 */

/** One effective skill, already resolved by the caller. */
export interface SkillInput {
  /** Skill slug, rendered as the block heading. */
  name: string;
  /** Markdown body as stored (not yet escaped). */
  body: string;
}

/**
 * Rough token estimate: ceil(chars / 4). Dependency-free and identical on the
 * client, so both show the same number. Undercounts Cyrillic/CJK by up to ~2×
 * (SPEC-02 D4) — label it as an estimate wherever it is shown.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
