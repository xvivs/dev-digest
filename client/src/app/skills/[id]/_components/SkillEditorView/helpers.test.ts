import { describe, it, expect } from "vitest";
import { resolveTab, withTab } from "./helpers";

describe("resolveTab", () => {
  it("keeps a known tab", () => {
    expect(resolveTab("preview")).toBe("preview");
  });

  it.each([null, "", "nope", "PREVIEW"])("falls back to config for %j", (raw) => {
    expect(resolveTab(raw)).toBe("config");
  });
});

describe("withTab", () => {
  it("sets tab and keeps the other params", () => {
    expect(withTab("foo=1&tab=stats", "preview")).toBe("foo=1&tab=preview");
  });

  it("adds tab to an empty query", () => {
    expect(withTab("", "preview")).toBe("tab=preview");
  });
});
