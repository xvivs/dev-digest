import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { buildSavePatch, draftChangeNote, estimateTokens, isSkillDirty } from "./helpers";

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

describe("estimateTokens", () => {
  it("rounds up chars / 4 (SPEC-02 D4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("buildSavePatch", () => {
  const draft = { name: SKILL.name, description: SKILL.description, type: SKILL.type, body: SKILL.body, enabled: SKILL.enabled };

  it("sends the trimmed note with a content change", () => {
    expect(buildSavePatch(SKILL, { ...draft, body: "# New" }, "  tightened  ")).toEqual({ ...draft, body: "# New", change_note: "tightened" });
  });

  it("omits a blank note", () => {
    expect(buildSavePatch(SKILL, { ...draft, body: "# New" }, "   ")).not.toHaveProperty("change_note");
  });

  it("omits the note on an enabled-only save, which creates no version", () => {
    expect(buildSavePatch(SKILL, { ...draft, enabled: false }, "why")).not.toHaveProperty("change_note");
  });
});

describe("draftChangeNote", () => {
  it("names the version the draft came from", () => {
    expect(draftChangeNote(3)).toBe("Restored from v3 (edited)");
  });
});
