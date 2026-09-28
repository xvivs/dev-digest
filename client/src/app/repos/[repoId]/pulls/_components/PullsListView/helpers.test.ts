import { describe, it, expect } from "vitest";
import type { PrStatus } from "@devdigest/shared";
import { filterAndSortPulls } from "./helpers";

type Row = { number: number; title: string; status: PrStatus; updated_at: string | null };

const row = (number: number, o: Partial<Row> = {}): Row => ({
  number,
  title: `PR ${number}`,
  status: "needs_review",
  updated_at: `2026-06-${String(number).padStart(2, "0")}T00:00:00.000Z`,
  ...o,
});

const PULLS: Row[] = [
  row(1, { title: "Fix login redirect", status: "reviewed" }),
  row(3, { title: "Add cost badge" }),
  row(2, { title: "Bump deps", status: "stale" }),
  row(4, { title: "Merged thing", status: "merged" }),
];

const numbers = (rows: Row[]) => rows.map((r) => r.number);
const ALL = { status: "all", query: "", sort: "newest" } as const;

describe("filterAndSortPulls", () => {
  it("returns an empty list while the query has no data", () => {
    expect(filterAndSortPulls(undefined, ALL)).toEqual([]);
  });

  it("keeps every status under `all`, newest update first", () => {
    expect(numbers(filterAndSortPulls(PULLS, ALL))).toEqual([4, 3, 2, 1]);
  });

  it("keeps only the requested status", () => {
    expect(numbers(filterAndSortPulls(PULLS, { ...ALL, status: "needs_review" }))).toEqual([3]);
    expect(numbers(filterAndSortPulls(PULLS, { ...ALL, status: "stale" }))).toEqual([2]);
  });

  it("returns nothing for an unknown ?status= value instead of ignoring the filter", () => {
    expect(filterAndSortPulls(PULLS, { ...ALL, status: "bogus" })).toEqual([]);
  });

  it("matches the query against the title, case-insensitively and trimmed", () => {
    expect(numbers(filterAndSortPulls(PULLS, { ...ALL, query: "  COST " }))).toEqual([3]);
  });

  it("matches the query against the PR number", () => {
    expect(numbers(filterAndSortPulls(PULLS, { ...ALL, query: "2" }))).toEqual([2]);
  });

  it("applies status and query together", () => {
    expect(filterAndSortPulls(PULLS, { ...ALL, status: "reviewed", query: "cost" })).toEqual([]);
  });

  it("sorts oldest first on request", () => {
    expect(numbers(filterAndSortPulls(PULLS, { ...ALL, sort: "oldest" }))).toEqual([1, 2, 3, 4]);
  });

  it("sorts a missing or unparseable updated_at as the oldest", () => {
    const rows = [row(1), row(2, { updated_at: null }), row(3, { updated_at: "garbage" })];
    expect(numbers(filterAndSortPulls(rows, ALL))).toEqual([1, 2, 3]);
    expect(numbers(filterAndSortPulls(rows, { ...ALL, sort: "oldest" }))).toEqual([2, 3, 1]);
  });

  it("never mutates its input", () => {
    const input = [...PULLS];
    filterAndSortPulls(input, { ...ALL, sort: "oldest" });
    expect(input).toEqual(PULLS);
  });
});
