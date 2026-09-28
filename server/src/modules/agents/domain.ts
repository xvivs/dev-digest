/**
 * DOMAIN — the core ring of the `agents` module. Pure: no I/O, no container,
 * no Drizzle, no Fastify. Only the error taxonomy in `platform/errors.ts`.
 *
 * Encodes the SPEC-02 invariants for `PUT /agents/:id/skills`: every linked
 * skill belongs to the agent's workspace (AC-31), and the enabled skills stay
 * within the per-agent body budget.
 */
import { AppError, NotFoundError } from '../../platform/errors.js';
import { AGENT_SKILLS_BODY_BUDGET_BYTES } from './constants.js';

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
 * Cross-tenant guard (AC-31): `found` holds only skills of the agent's
 * workspace, so any requested id missing from it is foreign or nonexistent.
 * Both answer 404 — the caller must not learn which.
 */
export function assertSkillsInWorkspace(links: SkillLinkInput[], found: LinkableSkill[]): void {
  const ids = new Set(found.map((s) => s.id));
  if (links.some((l) => !ids.has(l.skillId))) {
    throw new NotFoundError('One or more skills were not found in this workspace');
  }
}

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
