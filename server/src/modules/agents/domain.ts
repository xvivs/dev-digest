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
import { NotFoundError } from '../../platform/errors.js';
import type { LinkableSkill, SkillLinkInput } from '../_shared/skill-budget.js';

// Budget invariants live in `_shared/skill-budget.ts` (also used by conventions).
export {
  assertWithinSkillsBudget,
  enabledSkillsBodyBytes,
  type LinkableSkill,
  type SkillLinkInput,
} from '../_shared/skill-budget.js';

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
