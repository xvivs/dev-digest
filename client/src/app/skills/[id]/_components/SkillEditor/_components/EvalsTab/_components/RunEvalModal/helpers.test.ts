import { describe, it, expect } from "vitest";
import type { EvalCarrier } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { estimateCaseCount, preselectedCarrierId, runErrorCode } from "./helpers";

const carrier = (agent_id: string, is_default: boolean): EvalCarrier => ({ agent_id, agent_name: agent_id, runs: 1, is_default });

describe("preselectedCarrierId", () => {
  it("is the server's default carrier", () => {
    expect(preselectedCarrierId([carrier("a", false), carrier("b", true)])).toBe("b");
  });

  it("falls back to the first carrier when none is flagged, and is null when the list is empty", () => {
    expect(preselectedCarrierId([carrier("a", false), carrier("b", false)])).toBe("a");
    expect(preselectedCarrierId([])).toBeNull();
    expect(preselectedCarrierId(undefined)).toBeNull();
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
    expect(runErrorCode(new ApiError("x", 422, "eval_carrier_not_linked"))).toBe("eval_carrier_not_linked");
    expect(runErrorCode(new ApiError("x", 500, "internal"))).toBeNull();
    expect(runErrorCode(new Error("x"))).toBeNull();
  });
});
