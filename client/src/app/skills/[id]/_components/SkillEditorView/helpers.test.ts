import { describe, it, expect } from "vitest";
import { caseQuery, editorQuery, parseCaseParam, parseStatsWindow, resolveTab, statsWindowQuery, withTab } from "./helpers";

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

describe("editorQuery", () => {
  it("switches the tab and keeps unrelated params", () => {
    expect(editorQuery("foo=1&tab=versions", "config")).toBe("foo=1&tab=config");
  });
});

describe("parseStatsWindow", () => {
  it.each(["7d", "30d", "90d"] as const)("keeps %s", (w) => {
    expect(parseStatsWindow(w)).toBe(w);
  });

  it.each([null, "", "1d", "30D", "30"])("falls back to 30d for %j, matching the server default", (raw) => {
    expect(parseStatsWindow(raw)).toBe("30d");
  });
});

describe("statsWindowQuery", () => {
  it("sets window and keeps the tab and other params", () => {
    expect(statsWindowQuery("tab=stats&foo=1", "7d")).toBe("tab=stats&foo=1&window=7d");
  });

  it("replaces an existing window", () => {
    expect(statsWindowQuery("tab=stats&window=7d", "90d")).toBe("tab=stats&window=90d");
  });
});

describe("parseCaseParam", () => {
  it("reads an id", () => {
    expect(parseCaseParam("6f1c2a4e-9b7d-4c3a-8e21-0d5f6a7b8c9d")).toBe("6f1c2a4e-9b7d-4c3a-8e21-0d5f6a7b8c9d");
  });

  it.each([null, "", " ", "a b", "x".repeat(65), "<script>"])("ignores %j", (raw) => {
    expect(parseCaseParam(raw)).toBeNull();
  });
});

describe("caseQuery", () => {
  it("sets case and suite, keeping tab and other params", () => {
    expect(caseQuery("tab=evals&window=7d", "c1", "s1")).toBe("tab=evals&window=7d&case=c1&suite=s1");
  });

  it("opening a case without a suite drops a stale suite", () => {
    expect(caseQuery("tab=evals&case=c0&suite=s0", "c1", null)).toBe("tab=evals&case=c1");
  });

  it("null case closes the drawer: both params go", () => {
    expect(caseQuery("tab=evals&case=c1&suite=s1", null, null)).toBe("tab=evals");
  });
});

describe("editorQuery and the drawer", () => {
  it("a tab change drops ?case= and ?suite=", () => {
    expect(editorQuery("tab=evals&case=c1&suite=s1", "stats")).toBe("tab=stats");
  });
});
