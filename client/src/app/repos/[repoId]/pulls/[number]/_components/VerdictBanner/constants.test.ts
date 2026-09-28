import { describe, it, expect } from "vitest";
import { VERDICT_META } from "./constants";

// The one verdict colour table on the PR screen (the run accordion reads it
// too). Expected values are literals on purpose: comparing against
// VERDICT_META itself could never fail.
describe("VERDICT_META", () => {
  it("maps each verdict to its colour tokens", () => {
    expect(VERDICT_META.request_changes).toMatchObject({ c: "var(--crit)", bg: "var(--crit-bg)" });
    expect(VERDICT_META.approve).toMatchObject({ c: "var(--ok)", bg: "var(--ok-bg)" });
    // Was var(--warn) in the accordion's private copy while the banner used --info (ARCH-9).
    expect(VERDICT_META.comment).toMatchObject({ c: "var(--info)", bg: "var(--info-bg)" });
  });
});
