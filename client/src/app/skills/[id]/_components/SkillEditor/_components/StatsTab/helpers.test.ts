import { describe, it, expect } from "vitest";
import type { SkillAgentUsage } from "@devdigest/shared";
import {
  agentSkillsHref,
  costMissingReason,
  formatSignedDelta,
  passRatePercent,
  sortAgentsByRuns,
  sortVersionsDesc,
} from "./helpers";

const agent = (agent_name: string, runs: number): SkillAgentUsage => ({
  agent_id: agent_name,
  agent_name,
  status: "effective",
  runs,
});

describe("agentSkillsHref", () => {
  it("opens the agent on its Skills tab and encodes the id", () => {
    expect(agentSkillsHref("a/1")).toBe("/agents/a%2F1?tab=skills");
  });
});

describe("sortAgentsByRuns", () => {
  it("puts the busiest agent first and breaks ties by name", () => {
    const sorted = sortAgentsByRuns([agent("b", 2), agent("c", 9), agent("a", 2)]);
    expect(sorted.map((a) => a.agent_name)).toEqual(["c", "a", "b"]);
  });
});

describe("sortVersionsDesc", () => {
  it("lists the newest version first", () => {
    const rows = [1, 3, 2].map((version) => ({ version, runs: 0, tokens: 0, cost_usd: null, cost_source: null }));
    expect(sortVersionsDesc(rows).map((r) => r.version)).toEqual([3, 2, 1]);
  });
});

describe("costMissingReason", () => {
  it("is null when there is a cost", () => {
    expect(costMissingReason(0, 100)).toBeNull();
  });

  it("blames the price book when tokens were recorded but no cost came back", () => {
    expect(costMissingReason(null, 100)).toBe("no_price");
  });

  it("has no specific reason when nothing ran", () => {
    expect(costMissingReason(null, 0)).toBeNull();
  });
});

describe("passRatePercent", () => {
  it("rounds to a whole percent", () => {
    expect(passRatePercent(17, 20)).toBe(85);
    expect(passRatePercent(2, 3)).toBe(67);
  });

  it("is 0 with no cases instead of NaN", () => {
    expect(passRatePercent(0, 0)).toBe(0);
  });
});

describe("formatSignedDelta", () => {
  it.each([
    [0.4, "+0.4"],
    [-1.25, "−1.2"],
    [0, "0.0"],
    [0.04, "0.0"],
    [-0.04, "0.0"],
  ])("%s → %s", (value, expected) => {
    expect(formatSignedDelta(value)).toBe(expected);
  });
});
