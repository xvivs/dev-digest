import { describe, it, expect } from "vitest";
import type { Agent, SkillAgentUsage } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { defaultCarrierId, estimateCaseCount, runErrorCode } from "./helpers";

const agent = (id: string) => ({ id, name: id }) as Agent;
const usage = (agent_id: string, runs: number): SkillAgentUsage => ({ agent_id, agent_name: agent_id, status: "effective", runs });

describe("defaultCarrierId", () => {
  it("picks the agent with the most runs of this skill", () => {
    expect(defaultCarrierId([agent("a"), agent("b")], [usage("a", 3), usage("b", 40)])).toBe("b");
  });

  it("ignores deleted agents and zero-run links, falling back to the first agent", () => {
    expect(defaultCarrierId([agent("a"), agent("b")], [usage("gone", 99), usage("b", 0)])).toBe("a");
    expect(defaultCarrierId([agent("a")], undefined)).toBe("a");
  });

  it("is null with no agents", () => {
    expect(defaultCarrierId([], [usage("a", 3)])).toBeNull();
  });
});

describe("estimateCaseCount", () => {
  it("divides jobs by 2 arms × repeats", () => {
    expect(estimateCaseCount({ total_jobs: 120, repeats: 3 })).toBe(20);
    expect(estimateCaseCount({ total_jobs: 10, repeats: 1 })).toBe(5);
  });
});

describe("runErrorCode", () => {
  it("maps known server codes and nothing else", () => {
    expect(runErrorCode(new ApiError("x", 409, "eval_skill_not_vetted"))).toBe("eval_skill_not_vetted");
    expect(runErrorCode(new ApiError("x", 500, "internal"))).toBeNull();
    expect(runErrorCode(new Error("x"))).toBeNull();
  });
});
