import { describe, it, expect } from "vitest";
import { resolveTab, withTab } from "./helpers";

describe("resolveTab", () => {
  it("keeps a known tab", () => {
    expect(resolveTab("config")).toBe("config");
  });

  it.each([null, "", "nope", "CONFIG"])("falls back to config for %j", (raw) => {
    expect(resolveTab(raw)).toBe("config");
  });
});

describe("withTab", () => {
  it("sets tab and keeps the other params", () => {
    expect(withTab("foo=1&tab=stats", "config")).toBe("foo=1&tab=config");
  });

  it("adds tab to an empty query", () => {
    expect(withTab("", "config")).toBe("tab=config");
  });
});
