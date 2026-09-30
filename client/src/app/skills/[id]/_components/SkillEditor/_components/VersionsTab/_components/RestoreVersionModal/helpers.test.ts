import { describe, it, expect } from "vitest";
import { restoreResetsVetting } from "./helpers";

describe("restoreResetsVetting", () => {
  it("mirrors the server edit rule: imported and extracted reset, the rest keep their vet", () => {
    expect(restoreResetsVetting("imported")).toBe(true);
    expect(restoreResetsVetting("extracted")).toBe(true);
    expect(restoreResetsVetting("manual")).toBe(false);
    expect(restoreResetsVetting("imported_url")).toBe(false);
    expect(restoreResetsVetting("community")).toBe(false);
  });
});
