/**
 * DOMAIN — the core ring of the `skills` module. Pure: no I/O, no container,
 * no Drizzle, no Fastify, no runtime zod. Only `import type` from
 * `@devdigest/shared` and the error taxonomy in `platform/errors.ts`.
 *
 * Encodes ADR 0012 (trust tiers): an imported skill always starts disabled
 * and unvetted; editing an imported skill's body resets vetting; enabling a
 * skill that still needs vetting is refused.
 */
import type { SkillSource, SkillType } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { containsInvisibleChars } from '../_shared/text-hygiene.js';

export { containsInvisibleChars };

/** What the service reads and writes. Not a Drizzle row, not an HTTP DTO. */
export interface Skill {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  version: number;
  evidenceFiles: string[] | null;
  needsVetting: boolean;
  vettedBodyHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A skill plus how many agents link it (`GET /skills` row). */
export interface SkillListItem extends Skill {
  agentCount: number;
}

export interface NewSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  /** Resolved by `applySourcePolicy` — never trusted from the client on import. */
  enabled: boolean;
  needsVetting: boolean;
  /** sha256(body) for an auto-vetted (`extracted`) skill; omitted otherwise. */
  vettedBodyHash?: string | null;
  /** Files the rule was extracted from (`extracted` skills). */
  evidenceFiles?: string[] | null;
}

/** Fields the API allows a PUT to change (D8: partial body). */
export interface SkillPatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillNameTakenError extends AppError {
  constructor(name: string) {
    super('skill_name_taken', `A skill named "${name}" already exists in this workspace`, 409, {
      name,
    });
  }
}

/** The body changed after the person opened "Review & trust" (ADR 0012). */
export class SkillVetStaleError extends AppError {
  constructor(expected: number, actual: number) {
    super(
      'skill_vet_stale',
      'The skill changed while you were reviewing it. Review the current body again.',
      409,
      { expected_version: expected, current_version: actual },
    );
  }
}

export class SkillNotVettedError extends AppError {
  constructor() {
    super('skill_not_vetted', 'Skill must be vetted first', 409);
  }
}

export interface VettingTransition {
  needsVetting: boolean;
  vettedBodyHash: string | null;
}

/**
 * ADR 0012: editing the body of an IMPORTED or EXTRACTED skill resets vetting (ADR 0016) — the body a
 * person vetted is no longer the body that would ship. `bodyChanged` is
 * decided by the caller (it already has old + new body in hand); a manual
 * skill's `needsVetting` never flips true here (manual skills are trusted on
 * save and have no vetting workflow).
 */
export function resolveVettingOnBodyEdit(
  existing: Pick<Skill, 'source' | 'needsVetting' | 'vettedBodyHash'>,
  bodyChanged: boolean,
): VettingTransition {
  if (bodyChanged && (existing.source === 'imported' || existing.source === 'extracted')) {
    return { needsVetting: true, vettedBodyHash: null };
  }
  return { needsVetting: existing.needsVetting, vettedBodyHash: existing.vettedBodyHash };
}

/**
 * ADR 0012: a skill that still needs vetting cannot be enabled. Call this
 * AFTER `resolveVettingOnBodyEdit` so a same-request body edit that forces
 * `needsVetting: true` also blocks an `enabled: true` in that same patch.
 */
export function assertEnableAllowed(
  requestedEnabled: boolean | undefined,
  needsVettingAfterPatch: boolean,
): void {
  if (requestedEnabled === true && needsVettingAfterPatch) {
    throw new SkillNotVettedError();
  }
}
