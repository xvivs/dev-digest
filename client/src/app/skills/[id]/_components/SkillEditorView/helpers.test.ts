import { describe, it, expect } from "vitest";
import { editorQuery, parseFromVersion, resolveTab, withTab } from "./helpers";

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

describe("parseFromVersion", () => {
  it("reads a positive integer", () => {
    expect(parseFromVersion("3")).toBe(3);
  });

  it.each([null, "", "0", "-1", "2.5", "abc", "3abc"])("ignores %j", (raw) => {
    expect(parseFromVersion(raw)).toBeNull();
  });
});

describe("editorQuery", () => {
  it("opens config with a draft source and keeps unrelated params", () => {
    expect(editorQuery("foo=1&tab=versions", "config", 3)).toBe("foo=1&tab=config&fromVersion=3");
  });

  it("drops fromVersion on any other navigation, so a later visit to Config starts clean", () => {
    expect(editorQuery("tab=config&fromVersion=3", "preview")).toBe("tab=preview");
    expect(editorQuery("tab=config&fromVersion=3", "config")).toBe("tab=config");
  });
});
