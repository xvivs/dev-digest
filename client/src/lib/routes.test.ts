import { describe, expect, it } from "vitest";
import { agentSkillsHref, repoPullsHref, skillHref } from "./routes";

describe("repoPullsHref", () => {
  it("builds the PR list path", () => {
    expect(repoPullsHref("x")).toBe("/repos/x/pulls");
  });
});

describe("skillHref / agentSkillsHref", () => {
  it("opens a skill on its Config tab and an agent on its Skills tab", () => {
    expect(skillHref("sk 1")).toBe("/skills/sk%201?tab=config");
    expect(agentSkillsHref("ag1")).toBe("/agents/ag1?tab=skills");
  });
});
