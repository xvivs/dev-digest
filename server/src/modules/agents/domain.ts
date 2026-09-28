/**
 * DOMAIN — the core ring of the `agents` module. Pure: no I/O, no container,
 * no Drizzle, no Fastify. Only `import type` from `@devdigest/shared` and the
 * error taxonomy in `platform/errors.ts`.
 *
 * Holds the record shapes the `AgentStore` port speaks in, and encodes the SPEC-02 invariants for `PUT /agents/:id/skills`: every linked
 * skill belongs to the agent's workspace (AC-31), and the enabled skills stay
 * within the per-agent body budget.
 */
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { AGENT_SKILLS_BODY_BUDGET_BYTES } from './constants.js';

/** What the service reads: an agent's persisted config. Not a Drizzle row
 *  (the repository's row satisfies it structurally), not an HTTP DTO. */
export interface AgentRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema: unknown;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
  repoIntel: boolean;
  enabled: boolean;
  version: number;
  createdBy: string | null;
  createdAt: Date;
}

/** An immutable config snapshot. `configJson` is untyped until the mapper
 *  parses it through `AgentVersionConfig`. */
export interface AgentVersionRecord {
  agentId: string;
  version: number;
  configJson: unknown;
  createdAt: Date;
}

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
