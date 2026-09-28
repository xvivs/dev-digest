import { describe, it, expect } from "vitest";
import { modelLabel, toModelOptions } from "./model-label";

describe("modelLabel", () => {
  it("is the bare id with no pricing or context", () => {
    expect(modelLabel({ id: "gpt-4.1" })).toBe("gpt-4.1");
    expect(modelLabel({ id: "gpt-4.1", pricing: null, contextLength: null })).toBe("gpt-4.1");
  });

  it("formats prices: 3 decimals under $1, 2 decimals otherwise, 0 as 0", () => {
    expect(modelLabel({ id: "m", pricing: { promptPerM: 0.14, completionPerM: 0.28 } })).toBe(
      "m — $0.140/$0.280 per 1M",
    );
    expect(modelLabel({ id: "m", pricing: { promptPerM: 3, completionPerM: 15 } })).toBe(
      "m — $3.00/$15.00 per 1M",
    );
    expect(modelLabel({ id: "m", pricing: { promptPerM: 0, completionPerM: 0 } })).toBe("m — $0/$0 per 1M");
  });

  it("formats the context window in k or M", () => {
    expect(modelLabel({ id: "m", contextLength: 1_048_576 })).toBe("m — 1M ctx");
    expect(modelLabel({ id: "m", contextLength: 128_000 })).toBe("m — 128k ctx");
  });

  it("joins price and context", () => {
    expect(
      modelLabel({ id: "m", pricing: { promptPerM: 2, completionPerM: 8 }, contextLength: 200_000 }),
    ).toBe("m — $2.00/$8.00 per 1M · 200k ctx");
  });
});

describe("toModelOptions", () => {
  it("gives priced models a rich label and leaves bare ones as strings", () => {
    expect(
      toModelOptions([{ id: "a" }, { id: "b", contextLength: 32_000 }]),
    ).toEqual(["a", { value: "b", label: "b — 32k ctx" }]);
  });

  it("returns [] for undefined", () => {
    expect(toModelOptions(undefined)).toEqual([]);
  });
});
