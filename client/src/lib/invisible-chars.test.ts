import { describe, it, expect } from "vitest";
import { hasHtmlComment, hasInvisibleChars, splitInvisibleChars } from "./invisible-chars";

describe("splitInvisibleChars", () => {
  it("returns one printable segment for clean text", () => {
    expect(splitInvisibleChars("hello")).toEqual([{ text: "hello" }]);
  });

  it("returns a single empty segment for an empty body", () => {
    expect(splitInvisibleChars("")).toEqual([{ text: "" }]);
  });

  it("flags a zero-width space and a tag character with their code points", () => {
    const body = `a​b${String.fromCodePoint(0xe0041)}c`;
    expect(splitInvisibleChars(body)).toEqual([
      { text: "a" },
      { text: "​", invisibleLabel: "U+200B" },
      { text: "b" },
      { text: String.fromCodePoint(0xe0041), invisibleLabel: "U+E0041" },
      { text: "c" },
    ]);
  });
});

describe("hasInvisibleChars / hasHtmlComment", () => {
  it("detects bidi overrides", () => {
    expect(hasInvisibleChars("x‮y")).toBe(true);
    expect(hasInvisibleChars("plain")).toBe(false);
  });

  it("detects an HTML comment", () => {
    expect(hasHtmlComment("a <!-- hidden --> b")).toBe(true);
    expect(hasHtmlComment("a b")).toBe(false);
  });
});
