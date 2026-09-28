import type { Skill, SkillType } from "@devdigest/shared";

export interface SkillDraft {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled: boolean;
}

/** Whether the draft differs from the last-saved skill (AC-7, AC-8). */
export function isSkillDirty(skill: Skill, draft: SkillDraft): boolean {
  return (
    draft.name !== skill.name ||
    draft.description !== skill.description ||
    draft.type !== skill.type ||
    draft.body !== skill.body ||
    draft.enabled !== skill.enabled
  );
}

/**
 * SPEC-02 D4: `ceil(chars / 4)` — a pure, dependency-free estimate, duplicated
 * client-side (the server/reviewer-core copy is the one that gates the 24 KB
 * budget). It undercounts Cyrillic/CJK text; the UI always prefixes it with "≈".
 */
export function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}
