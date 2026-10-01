import { describe, it, expect } from "vitest";
import { cloneFailureReason, indexTooltip, isPrepareDone, nextContinuation, prepareButtonState, sha7 } from "./helpers";
import { readiness } from "./testFixtures";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const format = { relativeTime: (d: Date, now: Date) => `${Math.round((now.getTime() - d.getTime()) / 3_600_000)}h ago` };

describe("prepareButtonState (D11 table)", () => {
  it("loading or error → disabled label", () => {
    expect(prepareButtonState(undefined)).toEqual({ label: "label", enabled: false, busy: false, click: null });
  });
  it("in flight → preparing, busy, disabled", () => {
    expect(prepareButtonState(readiness({ index: { in_flight: true }, actions: ["derive_brief"] }))).toEqual({
      label: "preparing",
      enabled: false,
      busy: true,
      click: null,
    });
  });
  it("actions → Prepare, enabled", () => {
    expect(prepareButtonState(readiness({ actions: ["clone"] }))).toMatchObject({ label: "label", enabled: true, click: "prepare" });
  });
  it("actions and reindex_partial → Prepare first", () => {
    expect(prepareButtonState(readiness({ actions: ["derive_brief"], explicit_actions: ["reindex_partial"] }))).toMatchObject({
      click: "prepare",
    });
  });
  it("no actions, reindex_partial offered → Update index", () => {
    expect(prepareButtonState(readiness({ explicit_actions: ["reindex_partial"] }))).toMatchObject({
      label: "updateIndex",
      enabled: true,
      click: "updateIndex",
    });
  });
  it("no actions, blocked → disabled blocked label (PC-20)", () => {
    expect(prepareButtonState(readiness({ blocked_by: "head_moved" }))).toEqual({ label: "blocked", enabled: false, busy: false, click: null });
  });
  it("otherwise → disabled ready", () => {
    expect(prepareButtonState(readiness())).toEqual({ label: "ready", enabled: false, busy: false, click: null });
  });
});

describe("indexTooltip (D12 table)", () => {
  it("flag off", () => {
    expect(indexTooltip(readiness({ index: { status: "flag_off" } }), NOW, format)).toEqual({ key: "flagOff" });
  });
  it.each(["soft_budget", "graph_failed", "parse_errors", "no_files"] as const)("partial with reason %s", (reason) => {
    expect(indexTooltip(readiness({ index: { status: "partial", partial_reason: reason } }), NOW, format)).toEqual({
      key: "partial",
      reason,
      time: "24h ago",
    });
  });
  it("partial with no reason and no time → unknown / null", () => {
    expect(
      indexTooltip(readiness({ index: { status: "partial", partial_reason: null, last_indexed_at: null } }), NOW, format),
    ).toEqual({ key: "partial", reason: "unknown", time: null });
  });
  it("no row → never", () => {
    expect(indexTooltip(readiness({ index: { status: "missing", last_indexed_sha: null, last_indexed_at: null } }), NOW, format)).toEqual({
      key: "never",
    });
  });
  it("an empty sha with a time set → never (PC-7)", () => {
    expect(indexTooltip(readiness({ index: { status: "degraded", last_indexed_sha: null } }), NOW, format)).toEqual({ key: "never" });
  });
  it("time set → lastIndexed with sha7", () => {
    expect(indexTooltip(readiness(), NOW, format)).toEqual({ key: "lastIndexed", time: "24h ago", sha: "abcdef1" });
  });
  it("sha without time (pre-migration row) → notRecorded", () => {
    expect(indexTooltip(readiness({ index: { last_indexed_at: null } }), NOW, format)).toEqual({ key: "notRecorded", sha: "abcdef1" });
  });
  it("sha7 trims to seven characters and keeps a short sha", () => {
    expect(sha7("abcdef1234")).toBe("abcdef1");
    expect(sha7("abc")).toBe("abc");
  });
});

describe("nextContinuation (D13a)", () => {
  const intent = (fired: string[] = []) => ({ prId: "p1", fired: new Set(fired as never[]) });
  it("no intent → no call", () => {
    expect(nextContinuation(null, readiness({ actions: ["derive_brief"] }))).toEqual({ call: false });
  });
  it("action already fired → no call", () => {
    expect(nextContinuation(intent(["derive_brief"]), readiness({ actions: ["derive_brief"] }))).toEqual({ call: false });
  });
  it("only clone, or nothing, in actions → no call", () => {
    expect(nextContinuation(intent(), readiness({ actions: ["clone"] }))).toEqual({ call: false });
    expect(nextContinuation(intent(), readiness())).toEqual({ call: false });
  });
  it("derive_brief offered and not fired → call", () => {
    expect(nextContinuation(intent(), readiness({ actions: ["derive_brief"] }))).toEqual({ call: true, action: "derive_brief" });
  });
});

describe("isPrepareDone", () => {
  it("no actions and nothing in flight", () => {
    expect(isPrepareDone(readiness())).toBe(true);
    expect(isPrepareDone(readiness({ explicit_actions: ["reindex_partial"] }))).toBe(true);
    expect(isPrepareDone(readiness({ index: { in_flight: true } }))).toBe(false);
    expect(isPrepareDone(readiness({ actions: ["derive_brief"] }))).toBe(false);
  });
});

describe("cloneFailureReason", () => {
  const failure = { reason: "network", at: "2026-09-30T12:00:00.000Z" } as const;
  it("returns the reason only while clone is in the plan", () => {
    expect(cloneFailureReason(readiness({ clone: { last_failure: failure }, actions: ["clone"] }))).toBe("network");
    expect(cloneFailureReason(readiness({ clone: { last_failure: failure }, actions: [] }))).toBeNull();
    expect(cloneFailureReason(readiness({ actions: ["clone"] }))).toBeNull();
    expect(cloneFailureReason(undefined)).toBeNull();
  });
});
