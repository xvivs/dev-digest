/**
 * Skill invariants shared by `skills` (HTTP create/update) and `conventions`
 * (extracted skills): the zod field schemas and the ADR 0012 / ADR 0016 source
 * policy. Imported by routes/services, never by a `domain.ts`.
 */
import { z } from 'zod';
import type { SkillSource } from '@devdigest/shared';
import { sha256Hex } from './hash.js';
import { containsInvisibleChars } from './text-hygiene.js';

/** Skill name grammar: a lowercase slug, 2-64 chars. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const SKILL_DESCRIPTION_MAX = 500;
/** Body: 1..32768 chars (spec `body 1..32768 chars`). */
export const SKILL_BODY_MAX = 32768;

export const INVISIBLE_CHARS_MESSAGE =
  'Body contains disallowed invisible/bidi-control characters (Unicode tags, bidi overrides, zero-width, BOM)';

export const SkillName = z
  .string()
  .regex(SKILL_NAME_PATTERN, 'Name must be a lowercase slug: ^[a-z0-9][a-z0-9-]{1,63}$');

export const SkillDescription = z.string().max(SKILL_DESCRIPTION_MAX);

export const SkillBody = z
  .string()
  .min(1)
  .max(SKILL_BODY_MAX)
  .refine((body) => !containsInvisibleChars(body), { message: INVISIBLE_CHARS_MESSAGE });

export interface SourcePolicy {
  enabled: boolean;
  needsVetting: boolean;
  vettedBodyHash: string | null;
}

/**
 * Trust tier by source. manual: trusted on save. imported / imported_url /
 * community: always disabled + unvetted whatever was requested (ADR 0012).
 * extracted: the person reviewed the full body in the create flow, so it is
 * auto-vetted with the hash of exactly that body and `enabled` is honoured
 * (ADR 0016).
 */
export function applySourcePolicy(
  source: SkillSource,
  body: string,
  requestedEnabled: boolean,
): SourcePolicy {
  switch (source) {
    case 'manual':
      return { enabled: true, needsVetting: false, vettedBodyHash: null };
    case 'extracted':
      return { enabled: requestedEnabled, needsVetting: false, vettedBodyHash: sha256Hex(body) };
    default:
      return { enabled: false, needsVetting: true, vettedBodyHash: null };
  }
}
