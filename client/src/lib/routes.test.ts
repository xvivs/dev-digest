import { describe, expect, it } from "vitest";
import { repoPullsHref } from "./routes";

describe("repoPullsHref", () => {
  it("builds the PR list path", () => {
    expect(repoPullsHref("x")).toBe("/repos/x/pulls");
  });
});
