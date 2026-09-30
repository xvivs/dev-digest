import { describe, it, expect } from "vitest";
import { notIndexedView } from "./helpers";

describe("notIndexedView", () => {
  it.each([
    [{ notCloned: true, cloning: false, indexing: false }, "cloneCta", false],
    [{ notCloned: true, cloning: true, indexing: false }, "cloning", true],
    [{ notCloned: false, cloning: false, indexing: false }, "cta", false],
    [{ notCloned: false, cloning: false, indexing: true }, "indexing", true],
  ] as const)("%j -> %s (loading %s)", (input, ctaKey, ctaLoading) => {
    expect(notIndexedView(input)).toMatchObject({ ctaKey, ctaLoading });
  });

  it("ignores the indexing flag while the repo is not cloned, and vice versa", () => {
    expect(notIndexedView({ notCloned: true, cloning: false, indexing: true }).ctaKey).toBe("cloneCta");
    expect(notIndexedView({ notCloned: false, cloning: true, indexing: false }).ctaKey).toBe("cta");
  });

  it("picks the body and error title that match the branch", () => {
    expect(notIndexedView({ notCloned: true, cloning: false, indexing: false })).toMatchObject({
      bodyKey: "notCloned",
      errorTitleKey: "cloneErrorTitle",
    });
    expect(notIndexedView({ notCloned: false, cloning: false, indexing: false })).toMatchObject({
      bodyKey: "body",
      errorTitleKey: "errorTitle",
    });
  });
});
