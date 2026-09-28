import { describe, expect, it } from "vitest";
import { parsePatch, safeExternalHref } from "./helpers";

describe("parsePatch", () => {
  it("returns no lines for an empty, null or undefined patch (binary / unfetched file)", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parsePatch(null)).toEqual([]);
    expect(parsePatch(undefined)).toEqual([]);
  });

  it("numbers context, deleted and added lines from the hunk header", () => {
    const lines = parsePatch("@@ -10,3 +20,3 @@\n keep\n-old\n+new\n tail");
    expect(lines).toEqual([
      { kind: "hunk", text: "@@ -10,3 +20,3 @@" },
      { kind: "ctx", text: "keep", oldNo: 10, newNo: 20 },
      { kind: "del", text: "old", oldNo: 11 },
      { kind: "add", text: "new", newNo: 21 },
      { kind: "ctx", text: "tail", oldNo: 12, newNo: 22 },
    ]);
  });

  it("restarts numbering at every hunk, including headers without a line count", () => {
    const lines = parsePatch("@@ -1 +1 @@\n-a\n+b\n@@ -50,2 +60,2 @@ fn()\n ctx");
    expect(lines[3]).toEqual({ kind: "hunk", text: "@@ -50,2 +60,2 @@ fn()" });
    expect(lines[4]).toEqual({ kind: "ctx", text: "ctx", oldNo: 50, newNo: 60 });
  });

  it("keeps the counters when a hunk header does not parse", () => {
    const lines = parsePatch("@@ -3 +7 @@\n a\n@@ garbage @@\n b");
    expect(lines[3]).toEqual({ kind: "ctx", text: "b", oldNo: 4, newNo: 8 });
  });

  it("strips only the first marker character, so '++x' keeps one '+'", () => {
    const [, add, del] = parsePatch("@@ -1 +1 @@\n++x\n--y");
    expect(add).toMatchObject({ kind: "add", text: "+x" });
    expect(del).toMatchObject({ kind: "del", text: "-y" });
  });

  it("treats an unprefixed line as context without dropping a character", () => {
    const [, ctx] = parsePatch("@@ -1 +1 @@\nbare");
    expect(ctx).toEqual({ kind: "ctx", text: "bare", oldNo: 1, newNo: 1 });
  });

  it("skips the no-newline marker instead of counting it as a line", () => {
    const lines = parsePatch(
      "@@ -1,2 +1,2 @@\n-old\n\\ No newline at end of file\n+new\n+more\n\\ No newline at end of file",
    );
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "del", "add", "add"]);
    expect(lines[2]).toEqual({ kind: "add", text: "new", newNo: 1 });
    expect(lines[3]).toEqual({ kind: "add", text: "more", newNo: 2 });
  });
});

describe("safeExternalHref", () => {
  it("passes http and https URLs through unchanged", () => {
    const url = "https://github.com/acme/api/pull/1#discussion_r1";
    expect(safeExternalHref(url)).toBe(url);
    expect(safeExternalHref("http://ghe.local/x")).toBe("http://ghe.local/x");
  });

  it("drops script, data and relative URLs", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref(" JavaScript:alert(1)")).toBeNull();
    expect(safeExternalHref("data:text/html,<b>x</b>")).toBeNull();
    expect(safeExternalHref("/relative")).toBeNull();
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });
});
