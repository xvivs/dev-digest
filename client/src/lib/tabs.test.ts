import { describe, it, expect } from "vitest";
import { resolveTab, withTab } from "./tabs";

const TABS = ["config", "preview", "stats"] as const;

describe("resolveTab", () => {
  it("keeps a known tab", () => {
    expect(resolveTab("preview", TABS, "config")).toBe("preview");
  });

  it.each([null, "", "nope", "PREVIEW"])("falls back to the given fallback for %j", (raw) => {
    expect(resolveTab(raw, TABS, "config")).toBe("config");
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
