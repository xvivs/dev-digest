import type { Skill, SkillType } from "@devdigest/shared";
import type { UpdateSkillBody } from "@devdigest/shared/contracts/skill-impact";

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

/**
 * Default "What changed" note for a draft opened from vN (ADR 0016). It is
 * stored data, not UI copy, and matches the server's own "Restored from vN"
 * note for the one-click Restore — so it is not translated.
 */
export function draftChangeNote(version: number): string {
  return `Restored from v${version} (edited)`;
}

/**
 * The PUT body for Save. `change_note` goes only when it has text and a
 * versioned field changed: an `enabled`-only save creates no version
 * (ADR 0016), so a note there would describe nothing.
 */
export function buildSavePatch(skill: Skill, draft: SkillDraft, changeNote: string): UpdateSkillBody {
  const patch: UpdateSkillBody = { ...draft };
  const note = changeNote.trim();
  const contentChanged =
    draft.name !== skill.name ||
    draft.description !== skill.description ||
    draft.type !== skill.type ||
    draft.body !== skill.body;
  if (note && contentChanged) patch.change_note = note;
  return patch;
}
