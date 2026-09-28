/**
 * APPLICATION — use cases of the `skills` module. Depends on `domain.ts` and
 * `ports.ts` only: no Drizzle, no `db/**`, no Fastify, no concrete repository.
 * Owns the ADR 0012 trust-tier decisions (import policy, vetting reset, the
 * enable gate) and the transaction boundary for `update` (AC-9); the route
 * maps the returned domain object to the HTTP DTO.
 */
import type { SkillSource, SkillType } from '@devdigest/shared';
import {
  applyImportPolicy,
  assertEnableAllowed,
  resolveVettingOnBodyEdit,
  type Skill,
  type SkillListItem,
  type SkillPatch,
} from './domain.js';
import type { SkillStore } from './ports.js';

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source: SkillSource;
}

export class SkillsService {
  constructor(private readonly store: SkillStore) {}

  list(workspaceId: string, q?: string): Promise<SkillListItem[]> {
    return this.store.list(workspaceId, q);
  }

  get(workspaceId: string, id: string): Promise<Skill | undefined> {
    return this.store.findById(workspaceId, id);
  }

  /** ADR 0012: an import is always stored disabled + unvetted, whatever the
   *  request says — `applyImportPolicy` never reads a client-supplied
   *  enabled/needs_vetting because the input type has none. */
  create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const { enabled, needsVetting } = applyImportPolicy(input.source);
    return this.store.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      source: input.source,
      body: input.body,
      enabled,
      needsVetting,
    });
  }

  /**
   * Partial update in ONE transaction (AC-9 / D8): resolve the vetting
   * transition against the CURRENT row, refuse an enable that the same patch
   * would leave unvetted, then persist patch + version bump + `skill_versions`
   * snapshot atomically. Returns undefined when the skill isn't in this
   * workspace (route → 404).
   */
  update(workspaceId: string, id: string, patch: SkillPatch): Promise<Skill | undefined> {
    return this.store.transaction(async (tx) => {
      const existing = await tx.findById(workspaceId, id);
      if (!existing) return undefined;

      const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
      const vetting = resolveVettingOnBodyEdit(existing, bodyChanged);
      assertEnableAllowed(patch.enabled, vetting.needsVetting);

      return tx.update(workspaceId, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        needsVetting: vetting.needsVetting,
        vettedBodyHash: vetting.vettedBodyHash,
        bumpVersion: bodyChanged,
      });
    });
  }

  /** ADR 0012: records `vetted_body_hash = sha256(body)`, clears `needs_vetting`. */
  vet(workspaceId: string, id: string): Promise<Skill | undefined> {
    return this.store.vet(workspaceId, id);
  }

  /** Hard delete (D9): `agent_skills` links cascade; old traces keep their snapshot. */
  delete(workspaceId: string, id: string): Promise<boolean> {
    return this.store.deleteById(workspaceId, id);
  }
}
