import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { classifyCreateError, isModalDirty, type ModalFields } from "./helpers";

describe("classifyCreateError", () => {
  it("maps a taken name (AC-27)", () => {
    expect(classifyCreateError(new ApiError("x", 409, "skill_name_taken"))).toEqual({ kind: "name" });
  });

  it("maps a budget overrun with the offending agent (AC-28)", () => {
    expect(classifyCreateError(new ApiError("x", 422, "agent_skills_budget_exceeded", { agent_id: "ag1" }))).toEqual({
      kind: "budget",
      agentId: "ag1",
    });
    expect(classifyCreateError(new ApiError("x", 422, "agent_skills_budget_exceeded"))).toEqual({
      kind: "budget",
      agentId: null,
    });
  });

  it("maps a convention that is no longer accepted (AC-25)", () => {
    expect(classifyCreateError(new ApiError("x", 422, "convention_not_accepted"))).toEqual({ kind: "notAccepted" });
  });

  it("keeps the server message for anything else, and survives a non-API error", () => {
    expect(classifyCreateError(new ApiError("Bad body", 422, "hygiene"))).toEqual({ kind: "generic", message: "Bad body" });
    expect(classifyCreateError(new ApiError("Down", 0, "network_error"))).toEqual({ kind: "generic", message: "Down" });
    expect(classifyCreateError(new Error("oops"))).toEqual({ kind: "generic", message: "oops" });
    expect(classifyCreateError("weird")).toEqual({ kind: "generic", message: "" });
  });

  it("does not confuse a 409 with another code for a name clash", () => {
    expect(classifyCreateError(new ApiError("x", 409, "something_else"))).toMatchObject({ kind: "generic" });
  });
});

describe("isModalDirty", () => {
  const initial: ModalFields = { name: "n", description: "d", enabled: true, body: "b", agentIds: [] };

  it("is false for an identical form", () => {
    expect(isModalDirty(initial, { ...initial, agentIds: [] })).toBe(false);
  });

  it.each([
    ["name", { name: "m" }],
    ["description", { description: "e" }],
    ["enabled", { enabled: false }],
    ["body", { body: "c" }],
    ["agents", { agentIds: ["ag1"] }],
  ] as const)("is true when %s changes", (_field, change) => {
    expect(isModalDirty(initial, { ...initial, ...change })).toBe(true);
  });

  it("notices a swapped agent of the same count", () => {
    expect(isModalDirty({ ...initial, agentIds: ["a"] }, { ...initial, agentIds: ["b"] })).toBe(true);
  });
});
