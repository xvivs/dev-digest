import { describe, it, expect } from "vitest";
import { formatWhen, WHEN_FORMAT } from "./format-date";

const ISO = "2026-03-05T21:30:15Z";

describe("formatWhen", () => {
  it("matches Date#toLocaleString() with no options (the old inline copies)", () => {
    expect(formatWhen(ISO)).toBe(new Date(ISO).toLocaleString());
  });

  it("returns an unparseable input unchanged", () => {
    expect(formatWhen("not a date")).toBe("not a date");
    expect(formatWhen("")).toBe("");
  });

  it("is deterministic with an explicit locale + timeZone", () => {
    expect(formatWhen(ISO, { locale: "en-US", timeZone: "UTC" })).toBe("3/5/2026, 9:30:15 PM");
    // Kyiv is UTC+2 in March; a late-evening UTC instant lands on the next day there.
    expect(formatWhen(ISO, { locale: "en-US", timeZone: "Europe/Kyiv" })).toBe("3/5/2026, 11:30:15 PM");
    expect(formatWhen("2026-03-05T23:30:00Z", { locale: "en-US", timeZone: "Europe/Kyiv" })).toBe(
      "3/6/2026, 1:30:00 AM",
    );
  });

  it("WHEN_FORMAT reproduces the default toLocaleString fields", () => {
    const d = new Date(ISO);
    expect(d.toLocaleString("en-US", { ...WHEN_FORMAT, timeZone: "UTC" })).toBe(
      d.toLocaleString("en-US", { timeZone: "UTC" }),
    );
  });
});
