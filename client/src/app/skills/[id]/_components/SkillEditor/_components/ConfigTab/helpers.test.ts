import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { isSkillDirty } from "./helpers";

const SKILL: Skill = {
  id: "sk1",
  name: "branch-coverage-gate",
  description: "Flags untested branches.",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 1,
  needs_vetting: false,
};

describe("isSkillDirty", () => {
  it("is false when the draft matches the saved skill", () => {
    const draft = { name: SKILL.name, description: SKILL.description, type: SKILL.type, body: SKILL.body, enabled: SKILL.enabled };
    expect(isSkillDirty(SKILL, draft)).toBe(false);
  });

  it("is true when any single field diverges", () => {
    const base = { name: SKILL.name, description: SKILL.description, type: SKILL.type, body: SKILL.body, enabled: SKILL.enabled };
    expect(isSkillDirty(SKILL, { ...base, body: "# Rule\nmore" })).toBe(true);
    expect(isSkillDirty(SKILL, { ...base, name: "other-name" })).toBe(true);
    expect(isSkillDirty(SKILL, { ...base, enabled: false })).toBe(true);
    expect(isSkillDirty(SKILL, { ...base, type: "security" })).toBe(true);
  });
});
