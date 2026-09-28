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
import { AppError, ValidationError } from '../../platform/errors.js';
import {
  INVISIBLE_CHARS_PATTERN,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_PATTERN,
} from './constants.js';

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
  /** Resolved by `applyImportPolicy` — never trusted from the client on import. */
  enabled: boolean;
  needsVetting: boolean;
}

/** Fields the API allows a PUT to change (D8: partial body). */
export interface SkillPatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** ADR 0016: free-text "what changed", stored on the new snapshot only. */
  changeNote?: string;
}

/**
 * ADR 0016: one append-only `skill_versions` row = the state of every
 * versioned field at `version`. `name`/`description`/`type` are null on
 * snapshots written before the all-field migration (only the body was kept).
 */
export interface SkillVersionSnapshot {
  skillId: string;
  version: number;
  name: string | null;
  description: string | null;
  type: SkillType | null;
  body: string;
  changeNote: string | null;
  createdAt: Date;
}

/** `GET /skills/:id/versions` row: the snapshot without its body. */
export type SkillVersionSummary = Omit<SkillVersionSnapshot, 'body'>;

/** The versioned content fields (ADR 0016). `enabled` is deliberately absent. */
export type SkillContent = Pick<Skill, 'name' | 'description' | 'type' | 'body'>;

/**
 * ADR 0016: a change to any of name/description/type/body bumps the version
 * and writes a snapshot; toggling `enabled` never does. Returns the fields
 * of `patch` that actually differ from `current`.
 */
export function changedContent(
  current: SkillContent,
  patch: Partial<SkillContent>,
): Partial<SkillContent> {
  const out: Partial<SkillContent> = {};
  if (patch.name !== undefined && patch.name !== current.name) out.name = patch.name;
  if (patch.description !== undefined && patch.description !== current.description) {
    out.description = patch.description;
  }
  if (patch.type !== undefined && patch.type !== current.type) out.type = patch.type;
  if (patch.body !== undefined && patch.body !== current.body) out.body = patch.body;
  return out;
}

/**
 * ADR 0016: the content a restore of `snapshot` would write. A legacy snapshot
 * (null metadata) restores its body only and keeps the current metadata.
 */
export function restoreTarget(snapshot: SkillVersionSnapshot): Partial<SkillContent> {
  return {
    ...(snapshot.name !== null ? { name: snapshot.name } : {}),
    ...(snapshot.description !== null ? { description: snapshot.description } : {}),
    ...(snapshot.type !== null ? { type: snapshot.type } : {}),
    body: snapshot.body,
  };
}

/** Default note on a version created by `POST …/versions/:v/restore`. */
export function restoreChangeNote(version: number): string {
  return `Restored from v${version}`;
}

/** Empty / whitespace-only notes are stored as null. */
export function normalizeChangeNote(note: string | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

/**
 * ADR 0012 input limits apply to a restore as to a PUT: a snapshot written
 * under looser rules (or tampered with in the DB) must not come back in.
 * Throws a 422 `validation_error` naming the offending field.
 */
export function assertRestorableContent(content: Partial<SkillContent>): void {
  const fail = (field: string, reason: string): never => {
    throw new ValidationError(`Snapshot ${field} cannot be restored: ${reason}`, { field });
  };
  if (content.name !== undefined && !SKILL_NAME_PATTERN.test(content.name)) {
    fail('name', 'not a lowercase slug');
  }
  if (content.description !== undefined && content.description.length > SKILL_DESCRIPTION_MAX) {
    fail('description', `longer than ${SKILL_DESCRIPTION_MAX} chars`);
  }
  if (content.body !== undefined) {
    if (content.body.length < 1 || content.body.length > SKILL_BODY_MAX) {
      fail('body', `must be 1..${SKILL_BODY_MAX} chars`);
    }
    if (containsInvisibleChars(content.body)) fail('body', 'contains disallowed invisible characters');
  }
}

export function containsInvisibleChars(body: string): boolean {
  return INVISIBLE_CHARS_PATTERN.test(body);
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

/** ADR 0016: the skill moved past the version the client restored from. */
export class SkillVersionStaleError extends AppError {
  constructor(expected: number, actual: number) {
    super(
      'skill_version_stale',
      'The skill changed since you opened its history. Reload and try again.',
      409,
      { expected_version: expected, current_version: actual },
    );
  }
}

export class SkillVersionNotFoundError extends AppError {
  constructor(version: number) {
    super('not_found', `Skill version ${version} not found`, 404, { version });
  }
}

export class SkillNotVettedError extends AppError {
  constructor() {
    super('skill_not_vetted', 'Skill must be vetted first', 409);
  }
}

/**
 * ADR 0012 tiers: a manual skill is trusted on save. An imported skill always
 * starts disabled and unvetted, whatever the request asked for — the caller
 * (service) must never forward a client-supplied `enabled`/`needs_vetting` for
 * an import.
 */
export function applyImportPolicy(source: SkillSource): { enabled: boolean; needsVetting: boolean } {
  if (source === 'manual') return { enabled: true, needsVetting: false };
  return { enabled: false, needsVetting: true };
}

export interface VettingTransition {
  needsVetting: boolean;
  vettedBodyHash: string | null;
}

/**
 * ADR 0012: editing the body of an IMPORTED skill resets vetting — the body a
 * person vetted is no longer the body that would ship. `bodyChanged` is
 * decided by the caller (it already has old + new body in hand); a manual
 * skill's `needsVetting` never flips true here (manual skills are trusted on
 * save and have no vetting workflow).
 */
export function resolveVettingOnBodyEdit(
  existing: Pick<Skill, 'source' | 'needsVetting' | 'vettedBodyHash'>,
  bodyChanged: boolean,
): VettingTransition {
  if (bodyChanged && existing.source === 'imported') {
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
