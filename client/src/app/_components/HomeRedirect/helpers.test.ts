import { describe, it, expect } from "vitest";
import type { Repo } from "@devdigest/shared";
import { homeView, repoPullsHref } from "./helpers";

const repo = { id: "r1", full_name: "acme/api" } as Repo;

describe("homeView", () => {
  it("is loading while the query loads, even with cached data", () => {
    expect(homeView({ repos: [repo], isLoading: true, isError: false })).toEqual({ kind: "loading" });
  });

  it("is empty for no data, an empty list or an error", () => {
    expect(homeView({ repos: undefined, isLoading: false, isError: false }).kind).toBe("empty");
    expect(homeView({ repos: [], isLoading: false, isError: false }).kind).toBe("empty");
    expect(homeView({ repos: [repo], isLoading: false, isError: true }).kind).toBe("empty");
  });

  it("redirects to the first repo's PR list", () => {
    expect(homeView({ repos: [repo], isLoading: false, isError: false })).toEqual({
      kind: "redirect",
      repo,
      href: "/repos/r1/pulls",
    });
  });
});

describe("repoPullsHref", () => {
  it("builds the PR list path", () => {
    expect(repoPullsHref("x")).toBe("/repos/x/pulls");
  });
});
