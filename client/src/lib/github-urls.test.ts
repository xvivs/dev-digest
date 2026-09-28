import { describe, it, expect } from "vitest";
import { githubPrUrl, githubBlobUrl } from "./github-urls";

describe("githubPrUrl", () => {
  it("builds the PR link", () => {
    expect(githubPrUrl("acme/api", 42)).toBe("https://github.com/acme/api/pull/42");
  });
});

describe("githubBlobUrl", () => {
  const base = "https://github.com/acme/api/blob/abc123";

  it("links a file with no line anchor", () => {
    expect(githubBlobUrl("acme/api", "abc123", "src/a.ts")).toBe(`${base}/src/a.ts`);
  });

  it("anchors a single line, and collapses start === end", () => {
    expect(githubBlobUrl("acme/api", "abc123", "src/a.ts", 7)).toBe(`${base}/src/a.ts#L7`);
    expect(githubBlobUrl("acme/api", "abc123", "src/a.ts", 7, 7)).toBe(`${base}/src/a.ts#L7`);
  });

  it("anchors a line range", () => {
    expect(githubBlobUrl("acme/api", "abc123", "src/a.ts", 7, 12)).toBe(`${base}/src/a.ts#L7-L12`);
  });

  it("ignores an end line without a start line", () => {
    expect(githubBlobUrl("acme/api", "abc123", "src/a.ts", undefined, 12)).toBe(`${base}/src/a.ts`);
  });

  it("encodes each path segment but keeps the slashes", () => {
    expect(githubBlobUrl("acme/api", "abc123", "docs/my file#1.md")).toBe(`${base}/docs/my%20file%231.md`);
  });

  it("keeps line 0 (a falsy but present start line)", () => {
    expect(githubBlobUrl("acme/api", "abc123", "a.ts", 0)).toBe(`${base}/a.ts#L0`);
  });
});
