import { describe, it, expect } from "vitest";
import type { SkillEvalCase } from "@devdigest/shared";
import { CreateEvalCaseBody } from "@devdigest/shared/contracts/skill-impact";
import { buildCaseBody, buildExpectation, diffLineCount, draftFromCase, emptyRow, rowsForKind, type ExpectationRowDraft } from "./helpers";

const row = (patch: Partial<ExpectationRowDraft> = {}): ExpectationRowDraft => ({ ...emptyRow(1, "defect"), file: "src/a.ts", ...patch });

describe("buildExpectation", () => {
  it("builds must_find rows the contract accepts, dropping empty optional fields", () => {
    const res = buildExpectation("defect", [row({ start: "10", end: "14", contains: " sk_live " }), row({ key: 2, start: "7" })]);
    expect(res).toEqual({
      ok: true,
      value: {
        must_find: [
          { file: "src/a.ts", line_range: { start: 10, end: 14 }, min_severity: "WARNING", category: "bug", contains: "sk_live" },
          { file: "src/a.ts", line_range: { start: 7, end: 7 }, min_severity: "WARNING", category: "bug" },
        ],
      },
    });
  });

  it("builds a clean case where severity and category may be any", () => {
    const res = buildExpectation("clean", [row({ severity: "", category: "security" })]);
    expect(res).toEqual({ ok: true, value: { must_not_find: [{ file: "src/a.ts", category: "security" }] } });
  });

  it("reports the first bad row, 1-based", () => {
    expect(buildExpectation("defect", [row(), row({ file: " " })])).toEqual({ ok: false, error: { key: "file", index: 2 } });
    expect(buildExpectation("defect", [row({ start: "9", end: "3" })])).toEqual({ ok: false, error: { key: "lines", index: 1 } });
    expect(buildExpectation("defect", [row({ start: "", end: "3" })])).toEqual({ ok: false, error: { key: "lines", index: 1 } });
    expect(buildExpectation("defect", [row({ start: "0" })])).toEqual({ ok: false, error: { key: "lines", index: 1 } });
    expect(buildExpectation("defect", [])).toEqual({ ok: false, error: { key: "rows" } });
  });
});

describe("buildCaseBody", () => {
  it("a new pasted case parses as CreateEvalCaseBody", () => {
    const res = buildCaseBody({ name: " leak ", source: { mode: "paste", diff: "+x" }, kind: "defect", rows: [row()] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(CreateEvalCaseBody.safeParse(res.value).success).toBe(true);
  });

  it("a PR case needs a PR and at least one file", () => {
    expect(buildCaseBody({ name: "n", source: { mode: "pr", prId: null, files: [] }, kind: "defect", rows: [row()] })).toEqual({
      ok: false,
      error: { key: "pr" },
    });
    const res = buildCaseBody({ name: "n", source: { mode: "pr", prId: "p1", files: ["a.ts"] }, kind: "defect", rows: [row()] });
    expect(res.ok && res.value.source).toEqual({ kind: "pr", pr_id: "p1", files: ["a.ts"] });
  });

  it("an edit that keeps the diff sends no source", () => {
    const res = buildCaseBody({ name: "n", source: { mode: "keep" }, kind: "defect", rows: [row()] });
    expect(res.ok && "source" in res.value).toBe(false);
  });

  it("requires a name and a diff", () => {
    expect(buildCaseBody({ name: "", source: { mode: "paste", diff: "x" }, kind: "defect", rows: [row()] })).toEqual({ ok: false, error: { key: "name" } });
    expect(buildCaseBody({ name: "n", source: { mode: "paste", diff: " " }, kind: "defect", rows: [row()] })).toEqual({ ok: false, error: { key: "diff" } });
  });
});

describe("draftFromCase", () => {
  let k = 0;
  const next = () => ++k;

  it("reads a clean case back into clean rows and keeps the diff", () => {
    const c = {
      name: "clean-one",
      expectation: { must_find: [], must_not_find: [{ file: "b.ts", line_range: { start: 2, end: 4 }, contains: "todo" }] },
    } as unknown as SkillEvalCase;
    const d = draftFromCase(c, next);
    expect(d.kind).toBe("clean");
    expect(d.source).toEqual({ mode: "keep" });
    expect(d.rows).toMatchObject([{ file: "b.ts", start: "2", end: "4", severity: "", category: "", contains: "todo" }]);
  });

  it("a legacy case (no parsed expectation) opens as a defect case with one blank row", () => {
    const d = draftFromCase({ name: "old", expectation: null } as unknown as SkillEvalCase, next);
    expect(d.kind).toBe("defect");
    expect(d.rows).toHaveLength(1);
  });

  it("a new case starts on Paste diff", () => {
    expect(draftFromCase(null, next).source).toEqual({ mode: "paste", diff: "" });
  });
});

describe("rowsForKind / diffLineCount", () => {
  it("switching to defect fills required severity and category", () => {
    expect(rowsForKind([row({ severity: "", category: "" })], "defect")[0]).toMatchObject({ severity: "WARNING", category: "bug" });
  });

  it("counts diff lines, ignoring a trailing newline", () => {
    expect(diffLineCount("a\nb\n")).toBe(2);
    expect(diffLineCount("")).toBe(0);
  });
});
