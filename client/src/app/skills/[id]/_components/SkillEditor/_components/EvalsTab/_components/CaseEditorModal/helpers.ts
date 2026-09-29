import type {
  CreateEvalCaseInput,
  EvalExpectation,
  EvalExpectationInput,
  EvalLineRange,
  FindingCategory,
  Severity,
  SkillEvalCase,
  UpdateEvalCaseInput,
} from "@devdigest/shared";
import { DEFAULT_ROW_CATEGORY, DEFAULT_ROW_SEVERITY } from "./constants";

/** Defect case = `must_find` rows; clean case = `must_not_find` rows (never both — EvalExpectation). */
export type CaseKind = "defect" | "clean";

/** One expectation row as the form edits it: every field a string, "" = unset / any. */
export interface ExpectationRowDraft {
  key: number;
  file: string;
  start: string;
  end: string;
  severity: Severity | "";
  category: FindingCategory | "";
  contains: string;
}

/** Where the saved diff comes from. `keep` = editing, leave the snapshot as it is. */
export type SourceDraft =
  | { mode: "keep" }
  | { mode: "paste"; diff: string }
  | { mode: "pr"; prId: string | null; files: readonly string[] };

export interface CaseDraft {
  name: string;
  source: SourceDraft;
  kind: CaseKind;
  rows: readonly ExpectationRowDraft[];
}

/** A validation failure as a `skillEvals.caseModal.errors.*` key, with the 1-based row where it applies. */
export type CaseDraftError = { key: "name" | "diff" | "pr" | "rows" } | { key: "file" | "lines"; index: number };

export type Result<T> = { ok: true; value: T } | { ok: false; error: CaseDraftError };

/** A blank row for `kind`: defect rows need a severity and a category, clean rows default to "any". */
export function emptyRow(key: number, kind: CaseKind): ExpectationRowDraft {
  return {
    key,
    file: "",
    start: "",
    end: "",
    severity: kind === "defect" ? DEFAULT_ROW_SEVERITY : "",
    category: kind === "defect" ? DEFAULT_ROW_CATEGORY : "",
    contains: "",
  };
}

/** Switching kind keeps what the author typed and only fills the fields the new kind requires. */
export function rowsForKind(rows: readonly ExpectationRowDraft[], kind: CaseKind): ExpectationRowDraft[] {
  if (kind === "clean") return [...rows];
  return rows.map((r) => ({
    ...r,
    severity: r.severity || DEFAULT_ROW_SEVERITY,
    category: r.category || DEFAULT_ROW_CATEGORY,
  }));
}

/** The form state for an existing case (or a blank defect case). `nextKey` hands out row keys. */
export function draftFromCase(c: SkillEvalCase | null, nextKey: () => number): CaseDraft {
  const exp = c?.expectation ?? null;
  const kind: CaseKind = exp && exp.must_find.length === 0 && exp.must_not_find.length > 0 ? "clean" : "defect";
  const entries = exp ? (kind === "defect" ? exp.must_find : exp.must_not_find) : [];
  const rows = entries.map((e): ExpectationRowDraft => ({
    key: nextKey(),
    file: e.file,
    start: e.line_range ? String(e.line_range.start) : "",
    end: e.line_range ? String(e.line_range.end) : "",
    severity: e.min_severity ?? "",
    category: e.category ?? "",
    contains: e.contains ?? "",
  }));
  return {
    name: c?.name ?? "",
    source: c ? { mode: "keep" } : { mode: "paste", diff: "" },
    kind,
    rows: rows.length > 0 ? rows : [emptyRow(nextKey(), kind)],
  };
}

const POSITIVE_INT = /^[1-9]\d*$/;

/** "" + "" → no range; "12" + "" → 12..12; anything else must be whole numbers with end ≥ start. */
function lineRange(start: string, end: string): { ok: true; value: EvalLineRange | undefined } | { ok: false } {
  const a = start.trim();
  const b = end.trim();
  if (!a && !b) return { ok: true, value: undefined };
  if (!POSITIVE_INT.test(a) || (b && !POSITIVE_INT.test(b))) return { ok: false };
  const range = { start: Number(a), end: b ? Number(b) : Number(a) };
  return range.end >= range.start ? { ok: true, value: range } : { ok: false };
}

/** Form rows → EvalExpectation input, or the first row that is wrong. */
export function buildExpectation(kind: CaseKind, rows: readonly ExpectationRowDraft[]): Result<EvalExpectationInput> {
  if (rows.length === 0) return { ok: false, error: { key: "rows" } };
  const must_find: EvalExpectation["must_find"] = [];
  const must_not_find: EvalExpectation["must_not_find"] = [];
  for (const [i, r] of rows.entries()) {
    const index = i + 1;
    const file = r.file.trim();
    if (!file) return { ok: false, error: { key: "file", index } };
    const range = lineRange(r.start, r.end);
    if (!range.ok) return { ok: false, error: { key: "lines", index } };
    const contains = r.contains.trim() || undefined;
    const line_range = range.value;
    if (kind === "defect") {
      must_find.push({
        file,
        ...(line_range && { line_range }),
        min_severity: r.severity || DEFAULT_ROW_SEVERITY,
        category: r.category || DEFAULT_ROW_CATEGORY,
        ...(contains && { contains }),
      });
    } else {
      must_not_find.push({
        file,
        ...(line_range && { line_range }),
        ...(r.severity && { min_severity: r.severity }),
        ...(r.category && { category: r.category }),
        ...(contains && { contains }),
      });
    }
  }
  return { ok: true, value: kind === "defect" ? { must_find } : { must_not_find } };
}

function buildSource(source: SourceDraft): Result<CreateEvalCaseInput["source"] | undefined> {
  if (source.mode === "keep") return { ok: true, value: undefined };
  if (source.mode === "paste") {
    return source.diff.trim() ? { ok: true, value: { kind: "paste", diff: source.diff } } : { ok: false, error: { key: "diff" } };
  }
  return source.prId && source.files.length > 0
    ? { ok: true, value: { kind: "pr", pr_id: source.prId, files: [...source.files] } }
    : { ok: false, error: { key: "pr" } };
}

/**
 * The request body for the draft: a full `CreateEvalCaseBody` for a new case,
 * or a `PUT` patch for an edit (a kept diff sends no `source`, so the server
 * does not re-snapshot it).
 */
export function buildCaseBody(draft: CaseDraft): Result<CreateEvalCaseInput | UpdateEvalCaseInput> {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: { key: "name" } };
  const source = buildSource(draft.source);
  if (!source.ok) return source;
  const expectation = buildExpectation(draft.kind, draft.rows);
  if (!expectation.ok) return expectation;
  return {
    ok: true,
    value: source.value ? { name, source: source.value, expectation: expectation.value } : { name, expectation: expectation.value },
  };
}

/** Lines in a stored diff, for the "Current diff" line of the editor. */
export function diffLineCount(diff: string): number {
  return diff ? diff.replace(/\n$/, "").split("\n").length : 0;
}
