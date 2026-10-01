import { describe, it, expect } from "vitest";
import { isPlaceholderSuggestion } from "./helpers";

describe("isPlaceholderSuggestion", () => {
  it.each([":", "  ", "- ", "", "...", "\n", "—", "–", "…", "*", "_", " : - . ", null, undefined])(
    "treats %j as a placeholder",
    (v) => {
      expect(isPlaceholderSuggestion(v)).toBe(true);
    },
  );
  it.each(["Use an env var.", "- fix", "1", "Виправити", "`x`", "});", "```\n});\n```", "!=", "}"])(
    "keeps %j",
    (v) => {
      expect(isPlaceholderSuggestion(v)).toBe(false);
    },
  );
});
