import { describe, it, expect } from "vitest";
import { candidate, page, scan } from "../../fixtures";
import { MAX_SKILL_CONVENTIONS } from "../../constants";
import {
  allSelected,
  buildConventionPatch,
  canCreateSkill,
  emptyTabKind,
  errorMessage,
  isIndexBlocked,
  isRepoBlockedError,
  resolveScreen,
  shouldShowList,
  toggleAllSelected,
  visibleAcceptedIds,
  withSelected,
  type ScreenInput,
} from "./helpers";

const base: ScreenInput = { page: page({ candidates: [candidate("a")] }), loading: false, loadFailed: false, indexBlocked: false, indexPending: false };
const screenOf = (over: Partial<ScreenInput>) => resolveScreen({ ...base, ...over });

describe("resolveScreen (AC-32)", () => {
  it("is loading until the page answers", () => {
    expect(screenOf({ page: undefined, loading: true })).toBe("loading");
    expect(screenOf({ page: undefined })).toBe("loading");
  });

  it("is loadError when the query failed with nothing cached", () => {
    expect(screenOf({ page: undefined, loadFailed: true })).toBe("loadError");
  });

  it("is scanning whenever a scan runs, even with older candidates", () => {
    expect(screenOf({ page: page({ running_scan: scan({ status: "running" }), candidates: [candidate("a")] }) })).toBe("scanning");
  });

  it("is never for a repo that was never scanned", () => {
    expect(screenOf({ page: page({ last_scan: null, latest_done_scan: null }) })).toBe("never");
  });

  it("waits for the index state before offering the first scan", () => {
    expect(screenOf({ page: page({ last_scan: null, latest_done_scan: null }), indexPending: true })).toBe("loading");
  });

  it("is notIndexed when the index is unusable and nothing was ever scanned", () => {
    expect(screenOf({ page: page({ last_scan: null, latest_done_scan: null }), indexBlocked: true })).toBe("notIndexed");
    // a failed first attempt on an unusable index is still an index problem
    expect(screenOf({ page: page({ last_scan: scan({ status: "failed" }), latest_done_scan: null }), indexBlocked: true })).toBe("notIndexed");
  });

  it("keeps showing finished results when the index later degrades", () => {
    expect(screenOf({ indexBlocked: true })).toBe("list");
  });

  it("is failed when the last scan failed", () => {
    expect(screenOf({ page: page({ last_scan: scan({ status: "failed" }), latest_done_scan: null }) })).toBe("failed");
    expect(screenOf({ page: page({ last_scan: scan({ status: "failed" }), candidates: [candidate("a")] }) })).toBe("failed");
  });

  it("is zeroVerified for a done scan with no candidates", () => {
    expect(screenOf({ page: page({ candidates: [] }) })).toBe("zeroVerified");
  });

  it("is allRejected only when every candidate is rejected", () => {
    const rejected = (id: string) => candidate(id, { status: "rejected" });
    expect(screenOf({ page: page({ candidates: [rejected("a"), rejected("b")] }) })).toBe("allRejected");
    expect(screenOf({ page: page({ candidates: [rejected("a"), candidate("b", { status: "pending" })] }) })).toBe("list");
  });

  it("is list otherwise", () => {
    expect(screenOf({})).toBe("list");
  });
});

describe("isIndexBlocked", () => {
  it("passes full and partial, blocks the rest, and treats unknown as not blocked", () => {
    expect(isIndexBlocked("full")).toBe(false);
    expect(isIndexBlocked("partial")).toBe(false);
    expect(isIndexBlocked("degraded")).toBe(true);
    expect(isIndexBlocked("failed")).toBe(true);
    expect(isIndexBlocked(undefined)).toBe(false);
  });
});

describe("isRepoBlockedError", () => {
  it("recognises 409 repo_not_indexed and repo_not_cloned only", () => {
    expect(isRepoBlockedError({ message: "x", status: 409, code: "repo_not_indexed" })).toBe(true);
    expect(isRepoBlockedError({ message: "x", status: 409, code: "repo_not_cloned" })).toBe(true);
    expect(isRepoBlockedError({ message: "x", status: 409, code: "scan_running" })).toBe(false);
    expect(isRepoBlockedError({ message: "x", status: 500, code: "repo_not_indexed" })).toBe(false);
    expect(isRepoBlockedError(null)).toBe(false);
  });
});

describe("emptyTabKind", () => {
  it("uses the state-6 message on All only, and a per-tab hint elsewhere", () => {
    expect(emptyTabKind("allRejected", "all")).toBe("allRejected");
    expect(emptyTabKind("list", "all")).toBeNull();
    expect(emptyTabKind("list", "accepted")).toBe("accepted");
    expect(emptyTabKind("allRejected", "rejected")).toBe("rejected");
  });
});

describe("errorMessage", () => {
  it("is null when there is no error", () => {
    expect(errorMessage(null, "fallback")).toBeNull();
  });

  it("shows the server text of an error the API answered with", () => {
    expect(errorMessage({ message: "Clone is locked", status: 409, code: "clone_locked" }, "fallback")).toBe("Clone is locked");
  });

  it("falls back for an error that never reached the API", () => {
    expect(errorMessage({ message: "boom" }, "fallback")).toBe("fallback");
  });
});

describe("buildConventionPatch (AC-37)", () => {
  const current = { rule: "Old rule text", category: "async" as const };

  it("sends only the changed rule", () => {
    expect(buildConventionPatch(current, { rule: "New rule text", category: "async" })).toEqual({ rule: "New rule text" });
  });

  it("sends only the changed category", () => {
    expect(buildConventionPatch(current, { rule: current.rule, category: "testing" })).toEqual({ category: "testing" });
  });

  it("sends both when both changed", () => {
    expect(buildConventionPatch(current, { rule: "New rule text", category: "testing" })).toEqual({
      rule: "New rule text",
      category: "testing",
    });
  });

  it("returns null when nothing changed", () => {
    expect(buildConventionPatch(current, { ...current })).toBeNull();
  });

  it("treats an unknown current as everything changed", () => {
    expect(buildConventionPatch(undefined, { rule: "New rule text", category: "async" })).toEqual({
      rule: "New rule text",
      category: "async",
    });
  });
});

describe("selection helpers (AC-39)", () => {
  it("visibleAcceptedIds keeps only accepted candidates, in order", () => {
    const list = [candidate("a", { status: "accepted" }), candidate("b"), candidate("c", { status: "accepted" })];
    expect(visibleAcceptedIds(list)).toEqual(["a", "c"]);
  });

  it("allSelected is false for an empty id list", () => {
    expect(allSelected([], ["a"])).toBe(false);
  });

  it("allSelected needs every id selected", () => {
    expect(allSelected(["a", "b"], ["a", "b", "c"])).toBe(true);
    expect(allSelected(["a", "b"], ["a"])).toBe(false);
  });

  it("withSelected adds and removes without mutating the input", () => {
    const prev: ReadonlySet<string> = new Set(["a"]);
    expect([...withSelected(prev, "b", true)]).toEqual(["a", "b"]);
    expect([...withSelected(prev, "a", false)]).toEqual([]);
    expect([...prev]).toEqual(["a"]);
  });

  it("toggleAllSelected selects all ids, keeping unrelated ones", () => {
    expect([...toggleAllSelected(new Set(["x"]), ["a", "b"], false)].sort()).toEqual(["a", "b", "x"]);
  });

  it("toggleAllSelected deselects only the given ids", () => {
    const prev: ReadonlySet<string> = new Set(["a", "b", "x"]);
    expect([...toggleAllSelected(prev, ["a", "b"], true)]).toEqual(["x"]);
    expect(prev.size).toBe(3);
  });
});

describe("canCreateSkill", () => {
  it("needs at least one selected convention", () => {
    expect(canCreateSkill(0)).toBe(false);
    expect(canCreateSkill(1)).toBe(true);
  });

  it("is capped at MAX_SKILL_CONVENTIONS", () => {
    expect(canCreateSkill(MAX_SKILL_CONVENTIONS)).toBe(true);
    expect(canCreateSkill(MAX_SKILL_CONVENTIONS + 1)).toBe(false);
  });
});

describe("shouldShowList", () => {
  it("shows for list and allRejected", () => {
    expect(shouldShowList("list", 0)).toBe(true);
    expect(shouldShowList("allRejected", 2)).toBe(true);
  });

  it("shows under a failed scan only when older candidates exist", () => {
    expect(shouldShowList("failed", 1)).toBe(true);
    expect(shouldShowList("failed", 0)).toBe(false);
  });

  it("hides for every other screen", () => {
    for (const screen of ["loading", "loadError", "scanning", "notIndexed", "never", "zeroVerified"] as const) {
      expect(shouldShowList(screen, 5)).toBe(false);
    }
  });
});
