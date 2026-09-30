import { describe, expect, it } from "vitest";
import { isAutoBriefOn } from "./helpers";

describe("isAutoBriefOn", () => {
  it("is on when the setting is missing, null or undefined", () => {
    expect(isAutoBriefOn({} as { automatic_brief: boolean })).toBe(true);
    expect(isAutoBriefOn(null)).toBe(true);
    expect(isAutoBriefOn(undefined)).toBe(true);
  });

  it("is off only when explicitly false", () => {
    expect(isAutoBriefOn({ automatic_brief: false })).toBe(false);
    expect(isAutoBriefOn({ automatic_brief: true })).toBe(true);
  });
});
