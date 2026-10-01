import { describe, expect, it } from "vitest";
import type { DownstreamImpact, ReviewRecord, RunSummary } from "@devdigest/shared";
import blastMessages from "@/../messages/en/blast.json";
import { BLAST_REASONS, GRAPH, GRAPH_MAX_CALLERS, RESYNC_REASONS } from "./constants";
import {
  blastCallerHref,
  blastGraphLayout,
  blastStats,
  canResyncBlast,
  hasNoCallers,
  formatTokenArrow,
  selectLatestBrief,
  shouldShowConfidenceBadge,
  splitInlineCode,
} from "./helpers";

const run = (run_id: string, status: string | null, ran_at: string | null): RunSummary =>
  ({ run_id, status, ran_at }) as RunSummary;
const review = (run_id: string | null, verdict: ReviewRecord["verdict"] = "approve"): ReviewRecord =>
  ({ id: `rv-${run_id}`, run_id, verdict }) as ReviewRecord;
const impact = (symbol: string, callerCount: number, extra: Partial<DownstreamImpact> = {}): DownstreamImpact => ({
  symbol,
  callers: Array.from({ length: callerCount }, (_, i) => ({ name: `${symbol}Caller${i}`, file: "f.ts", line: i + 1 })),
  endpoints_affected: [],
  crons_affected: [],
  ...extra,
});
const rowY = (i: number) => GRAPH.pad + i * GRAPH.rowHeight + GRAPH.rowHeight / 2;

describe("selectLatestBrief", () => {
  it("returns null when there are no runs", () => {
    expect(selectLatestBrief([], [])).toBeNull();
  });

  it("returns null when no done run has a persisted review", () => {
    expect(selectLatestBrief([run("a", "done", "2026-01-01T00:00:00Z")], [])).toBeNull();
    expect(selectLatestBrief([run("a", "failed", "2026-01-01T00:00:00Z")], [review("a")])).toBeNull();
  });

  it("picks the newest done run regardless of input order, with no newerRun", () => {
    const runs = [run("old", "done", "2026-01-01T00:00:00Z"), run("new", "done", "2026-01-02T00:00:00Z")];
    const got = selectLatestBrief(runs, [review("old", "approve"), review("new", "request_changes")]);
    expect(got?.run.run_id).toBe("new");
    expect(got?.verdict).toBe("request_changes");
    expect(got?.newerRun).toBeNull();
  });

  it.each(["running", "failed", "cancelled"] as const)("flags a newer %s run as newerRun", (status) => {
    const runs = [run("done1", "done", "2026-01-01T00:00:00Z"), run("later", status, "2026-01-02T00:00:00Z")];
    const got = selectLatestBrief(runs, [review("done1")]);
    expect(got?.run.run_id).toBe("done1");
    expect(got?.newerRun).toBe(status);
  });

  it("ignores a non-done run that is older than the shown one", () => {
    const runs = [run("failedOld", "failed", "2026-01-01T00:00:00Z"), run("done1", "done", "2026-01-02T00:00:00Z")];
    expect(selectLatestBrief(runs, [review("done1")])?.newerRun).toBeNull();
  });

  it("falls back to an older done run when the newest done run has no review", () => {
    const runs = [run("a", "done", "2026-01-01T00:00:00Z"), run("b", "done", "2026-01-02T00:00:00Z")];
    expect(selectLatestBrief(runs, [review("a")])?.run.run_id).toBe("a");
  });

  it("defaults a null verdict to comment", () => {
    const got = selectLatestBrief([run("a", "done", "2026-01-01T00:00:00Z")], [review("a", null)]);
    expect(got?.verdict).toBe("comment");
  });
});

describe("splitInlineCode", () => {
  it("returns no segments for an empty string", () => {
    expect(splitInlineCode("")).toEqual([]);
  });

  it("splits backtick spans into code segments", () => {
    expect(splitInlineCode("call `foo()` then `bar`")).toEqual([
      { text: "call ", code: false },
      { text: "foo()", code: true },
      { text: " then ", code: false },
      { text: "bar", code: true },
    ]);
  });

  it("keeps an unmatched backtick as literal plain text", () => {
    expect(splitInlineCode("use `foo and more")).toEqual([
      { text: "use ", code: false },
      { text: "`foo and more", code: false },
    ]);
  });

  it("leaves HTML untouched as plain text", () => {
    const html = "<script>alert(1)</script> <b>x</b>";
    expect(splitInlineCode(html)).toEqual([{ text: html, code: false }]);
    expect(splitInlineCode("`<img src=x onerror=1>`")).toEqual([{ text: "<img src=x onerror=1>", code: true }]);
  });
});

describe("blastStats", () => {
  it("returns zeros for null/undefined", () => {
    const zero = { symbols: 0, callers: 0, endpoints: 0, crons: 0 };
    expect(blastStats(null)).toEqual(zero);
    expect(blastStats(undefined)).toEqual(zero);
  });

  it("counts every caller but dedupes endpoints and crons across symbols", () => {
    const stats = blastStats({
      changed_symbols: [
        { name: "a", file: "a.ts", kind: "function" },
        { name: "b", file: "b.ts", kind: "function" },
      ],
      downstream: [
        impact("a", 2, { endpoints_affected: ["GET /x", "POST /y"], crons_affected: ["nightly"] }),
        impact("b", 1, { endpoints_affected: ["GET /x"], crons_affected: ["nightly", "hourly"] }),
      ],
      summary: "",
    });
    expect(stats).toEqual({ symbols: 2, callers: 3, endpoints: 2, crons: 2 });
  });
});

describe("blastGraphLayout", () => {
  it("returns null when there are no downstream entries or no callers", () => {
    expect(blastGraphLayout([])).toBeNull();
    expect(blastGraphLayout([impact("a", 0), impact("b", 0)])).toBeNull();
  });

  it("ties each caller's fromY to the row of the symbol that calls it", () => {
    const layout = blastGraphLayout([impact("a", 1), impact("b", 2)]);
    expect(layout?.symbols).toEqual([
      { label: "a", y: rowY(0) },
      { label: "b", y: rowY(1) },
    ]);
    expect(layout?.callers.map((c) => c.fromY)).toEqual([rowY(0), rowY(1), rowY(1)]);
    expect(layout?.callers.map((c) => c.y)).toEqual([rowY(0), rowY(1), rowY(2)]);
    expect(layout?.callers[0]?.label).toBe("aCaller0:1");
    expect(layout?.hidden).toBe(0);
  });

  it("skips symbols without callers but still gives them a row", () => {
    const layout = blastGraphLayout([impact("a", 0), impact("b", 1)]);
    expect(layout?.callers[0]?.fromY).toBe(rowY(1));
    expect(layout?.height).toBe(2 * GRAPH.rowHeight + GRAPH.pad * 2);
  });

  it("caps drawn callers at GRAPH_MAX_CALLERS and reports the rest as hidden", () => {
    const layout = blastGraphLayout([impact("a", GRAPH_MAX_CALLERS + 3)]);
    expect(layout?.callers).toHaveLength(GRAPH_MAX_CALLERS);
    expect(layout?.hidden).toBe(3);
    const exact = blastGraphLayout([impact("a", GRAPH_MAX_CALLERS)]);
    expect(exact?.callers).toHaveLength(GRAPH_MAX_CALLERS);
    expect(exact?.hidden).toBe(0);
  });

  it("grows the height with the number of rows, bounded by the cap", () => {
    const one = blastGraphLayout([impact("a", 1)]);
    const three = blastGraphLayout([impact("a", 3)]);
    const many = blastGraphLayout([impact("a", GRAPH_MAX_CALLERS + 5)]);
    expect(one?.height).toBe(GRAPH.rowHeight + GRAPH.pad * 2);
    expect(three?.height).toBe(3 * GRAPH.rowHeight + GRAPH.pad * 2);
    expect(many?.height).toBe(GRAPH_MAX_CALLERS * GRAPH.rowHeight + GRAPH.pad * 2);
    const manySymbols = blastGraphLayout(Array.from({ length: 10 }, (_, i) => impact(`s${i}`, i === 0 ? 1 : 0)));
    expect(manySymbols?.height).toBe(10 * GRAPH.rowHeight + GRAPH.pad * 2);
  });
});

describe("blastGraphLayout callers", () => {
  it("carry the file and line of the source caller, in order", () => {
    const layout = blastGraphLayout([impact("a", 2), impact("b", 1)]);
    expect(layout?.callers.map((c) => [c.file, c.line])).toEqual([["f.ts", 1], ["f.ts", 2], ["f.ts", 1]]);
    expect(layout?.callers.map((c) => c.label)).toEqual(["aCaller0:1", "aCaller1:2", "bCaller0:1"]);
  });
});

describe("blastCallerHref", () => {
  it("builds the GitHub blob URL at the line, encoding path segments", () => {
    expect(blastCallerHref("o/r", "abc123", "src/a b/c#.ts", 12)).toBe(
      "https://github.com/o/r/blob/abc123/src/a%20b/c%23.ts#L12",
    );
  });

  it("is null without a repo name or sha (including an empty sha)", () => {
    expect(blastCallerHref(null, "abc", "f.ts", 1)).toBeNull();
    expect(blastCallerHref(undefined, "abc", "f.ts", 1)).toBeNull();
    expect(blastCallerHref("o/r", null, "f.ts", 1)).toBeNull();
    expect(blastCallerHref("o/r", "", "f.ts", 1)).toBeNull();
  });
});

describe("canResyncBlast", () => {
  it.each([
    ["degraded", "index_partial", true],
    ["degraded", "index_failed", true],
    ["degraded", "no_index", true],
    ["degraded", "no_data", true],
    ["degraded", "flag_off", false],
    ["degraded", "repo_too_large", false],
    ["degraded", "no_changed_files", false],
    ["degraded", null, false],
    ["ok", "index_partial", false],
    ["unavailable", "no_data", false],
  ] as const)("%s / %s -> %s", (status, reason, want) => {
    expect(canResyncBlast(status, reason)).toBe(want);
  });

  it("agrees with RESYNC_REASONS", () => {
    for (const r of BLAST_REASONS) expect(canResyncBlast("degraded", r)).toBe(RESYNC_REASONS.includes(r));
  });
});

describe("hasNoCallers", () => {
  const blast = (downstream: DownstreamImpact[]) => ({
    changed_symbols: downstream.map((d) => ({ name: d.symbol, file: "f.ts", kind: "function" as const })),
    downstream,
    summary: "",
  });
  it("is true with zero symbols and with symbols that have no callers", () => {
    expect(hasNoCallers(blast([]))).toBe(true);
    expect(hasNoCallers(blast([impact("a", 0), impact("b", 0)]))).toBe(true);
    expect(hasNoCallers(null)).toBe(true);
  });
  it("is false with one caller", () => {
    expect(hasNoCallers(blast([impact("a", 0), impact("b", 1)]))).toBe(false);
  });
});

describe("blast.json copy", () => {
  it("has a reason.<value> string for every BLAST_REASONS entry", () => {
    for (const r of BLAST_REASONS) {
      expect((blastMessages.reason as Record<string, string>)[r], r).toBeTruthy();
    }
  });
});

describe("shouldShowConfidenceBadge", () => {
  it("flags low and medium confidence only", () => {
    expect(shouldShowConfidenceBadge("low")).toBe(true);
    expect(shouldShowConfidenceBadge("medium")).toBe(true);
    expect(shouldShowConfidenceBadge("high")).toBe(false);
  });
});

describe("formatTokenArrow", () => {
  it("formats in→out with an uppercase K and one decimal", () => {
    expect(formatTokenArrow(8200, 1300)).toBe("8.2K→1.3K");
    expect(formatTokenArrow(950, null)).toBe("950→—");
    expect(formatTokenArrow(null, null)).toBeNull();
  });
});
