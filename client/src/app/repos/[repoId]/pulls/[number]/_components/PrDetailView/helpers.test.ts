import { describe, expect, it } from "vitest";
import { parseSeverity, parseTab, prDetailHref } from "./helpers";

describe("parseSeverity", () => {
  it("passes through a valid severity", () => {
    expect(parseSeverity("CRITICAL")).toBe("CRITICAL");
  });

  it("returns null for anything outside SEVERITIES", () => {
    expect(parseSeverity("bogus")).toBeNull();
    expect(parseSeverity(null)).toBeNull();
  });
});

describe("parseTab", () => {
  it("passes through each valid tab", () => {
    expect(parseTab("overview")).toBe("overview");
    expect(parseTab("findings")).toBe("findings");
    expect(parseTab("diff")).toBe("diff");
  });

  it("falls back to the default tab for an invalid ?tab= value", () => {
    expect(parseTab("bogus")).toBe("overview");
  });

  it("falls back to the default tab when there is no ?tab= at all", () => {
    expect(parseTab(null)).toBe("overview");
  });
});

describe("prDetailHref", () => {
  it("sets a query param", () => {
    expect(prDetailHref("r1", "5", "", "tab", "diff")).toBe("/repos/r1/pulls/5?tab=diff");
  });

  it("removes a query param when the value is null", () => {
    expect(prDetailHref("r1", "5", "tab=diff", "tab", null)).toBe("/repos/r1/pulls/5");
  });
});
