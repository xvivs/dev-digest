/**
 * Enabled-skills body budget per agent (SPEC-02). Shared by `agents` (link
 * replace) and any feature that attaches skills to agents. Pure.
 */
import { AppError } from '../../platform/errors.js';

/**
 * SPEC-02 non-functional: enabled-skills budget per agent — 24 KB of body
 * text (≈6k tokens). In map-reduce the skills block repeats per file chunk,
 * so cost scales with files × skills; the budget caps the per-call size.
 */
export const AGENT_SKILLS_BODY_BUDGET_BYTES = 24576;

/** One requested link — order is the array index. */
export interface SkillLinkInput {
  skillId: string;
  enabled: boolean;
}

/** The slice of a workspace skill the link invariants need. */
export interface LinkableSkill {
  id: string;
  enabled: boolean;
  body: string;
}

const utf8 = new TextEncoder();

/**
 * UTF-8 bytes of the bodies that would reach the prompt: only links that are
 * enabled AND point at an enabled skill count.
 */
export function enabledSkillsBodyBytes(links: SkillLinkInput[], found: LinkableSkill[]): number {
  const byId = new Map(found.map((s) => [s.id, s]));
  return links.reduce((sum, l) => {
    if (!l.enabled) return sum;
    const skill = byId.get(l.skillId);
    if (!skill || !skill.enabled) return sum;
    return sum + utf8.encode(skill.body).length;
  }, 0);
}

/** 422 when the enabled skills exceed `AGENT_SKILLS_BODY_BUDGET_BYTES`. */
export function assertWithinSkillsBudget(budgetBytes: number): void {
  if (budgetBytes > AGENT_SKILLS_BODY_BUDGET_BYTES) {
    throw new AppError(
      'agent_skills_budget_exceeded',
      `Enabled skills total ${budgetBytes} bytes, exceeding the ${AGENT_SKILLS_BODY_BUDGET_BYTES}-byte budget`,
      422,
      { budget_bytes: budgetBytes, limit_bytes: AGENT_SKILLS_BODY_BUDGET_BYTES },
    );
  }
}
