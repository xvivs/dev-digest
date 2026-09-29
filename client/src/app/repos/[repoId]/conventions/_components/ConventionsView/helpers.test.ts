import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { candidate, page, scan } from "../../fixtures";
import { emptyTabKind, isIndexBlocked, isRepoBlockedError, resolveScreen, type ScreenInput } from "./helpers";

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
    expect(isRepoBlockedError(new ApiError("x", 409, "repo_not_indexed"))).toBe(true);
    expect(isRepoBlockedError(new ApiError("x", 409, "repo_not_cloned"))).toBe(true);
    expect(isRepoBlockedError(new ApiError("x", 409, "scan_running"))).toBe(false);
    expect(isRepoBlockedError(new ApiError("x", 500, "repo_not_indexed"))).toBe(false);
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
