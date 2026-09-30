/**
 * EvalCaseDrawer — driven through the REAL useEvalCaseDetail hook with only
 * the transport (`api`) faked; every answer is parsed through the schema the
 * hook hands over (ADR 0007), so the fixture is held to the contract.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import type { EvalCaseDetail } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { EVAL_SUITE_POLL_INTERVAL_MS } from "@/lib/hooks/evals";
import { renderWithProviders } from "@/test/render";
import evalMessages from "../../../../../../../../../../messages/en/eval.json";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
import costMessages from "../../../../../../../../../../messages/en/cost.json";

type Schema = { parse: (v: unknown) => unknown };
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: h.get } };
});

import { EvalCaseDrawer } from "./EvalCaseDrawer";

const UUID1 = "6f1c2a4e-9b7d-4c3a-8e21-0d5f6a7b8c9d";
const UUID2 = "7f1c2a4e-9b7d-4c3a-8e21-0d5f6a7b8c9e";

const run = (over: Record<string, unknown> = {}) => ({
  repeat_idx: 0,
  status: "done",
  pass: true,
  matched_must_find: [0],
  missed_must_find: [1],
  unexpected: 0,
  unexpected_findings: [],
  duration_ms: 1200,
  cost_usd: 0.01,
  cost_source: "provider",
  error: null,
  ...over,
});

const DETAIL = {
  case: {
    id: "c1",
    skill_id: "sk1",
    name: "stripe-key-leak",
    notes: null,
    expectation: {
      must_find: [
        { file: "src/config.ts", min_severity: "CRITICAL", category: "security", line_range: { start: 10, end: 12 } },
        { file: "src/pay.ts", min_severity: "WARNING", category: "bug", contains: "retry" },
      ],
      must_not_find: [],
    },
    input_source: { kind: "pr", pr_id: UUID1, pr_number: 42, head_sha: "abc", files: ["src/config.ts"] },
    input_files: ["src/config.ts", "src/pay.ts"],
    input_diff_preview: "+const key = 'sk_live_x'",
    input_diff_chars: 5000,
    input_diff_truncated: true,
    created_at: "2026-09-29T09:00:00.000Z",
    updated_at: "2026-09-29T09:00:00.000Z",
  },
  suite: {
    id: UUID1,
    mode: "full",
    status: "done",
    carrier_name: "Strict reviewer",
    skill_version: 3,
    repeats: 3,
    stale: true,
    partial: false,
    created_at: "2026-09-29T10:00:00.000Z",
  },
  arms: {
    with: {
      passed: 2,
      total: 3,
      matched_median: 1,
      unexpected_median: 1,
      runs: [
        run({ unexpected: 2, unexpected_findings: [{ file: "src/extra.ts", line: 7, severity: "WARNING", category: "bug", title: "Unused retry" }] }),
        run({ repeat_idx: 1 }),
        run({ repeat_idx: 2, pass: false, matched_must_find: [], missed_must_find: [0, 1], error: null }),
      ],
    },
    without: {
      passed: 0,
      total: 3,
      matched_median: 0,
      unexpected_median: 0,
      runs: [
        run({ pass: false, matched_must_find: [], missed_must_find: [0, 1] }),
        run({ repeat_idx: 1, status: "failed", pass: null, matched_must_find: [], missed_must_find: [], error: "Timed out after 1560s" }),
        run({ repeat_idx: 2, pass: false, matched_must_find: [], missed_must_find: [0, 1] }),
      ],
    },
  },
  outcome: "flaky",
  expectation_changed: false,
  history: [
    { suite_id: UUID1, created_at: "2026-09-29T10:00:00.000Z", mode: "full", outcome: "flaky", skill_version: 3, stale: true, partial: false },
    { suite_id: UUID2, created_at: "2026-09-28T10:00:00.000Z", mode: "quick", outcome: "caught", skill_version: 2, stale: false, partial: true },
  ],
} as unknown as EvalCaseDetail;

let answer: () => unknown;

beforeEach(() => {
  answer = () => DETAIL;
  h.get.mockReset().mockImplementation((path: string, schema?: Schema) => {
    if (!path.startsWith("/eval-cases/c1")) return Promise.reject(new ApiError(`unexpected GET ${path}`, 404));
    const v = answer();
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(schema ? schema.parse(v) : v);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderDrawer(over: Partial<React.ComponentProps<typeof EvalCaseDrawer>> = {}) {
  const props = {
    caseId: "c1",
    suiteId: null,
    onClose: vi.fn(),
    onSelectSuite: vi.fn(),
    onRun: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  const view = renderWithProviders(<EvalCaseDrawer {...props} />, {
    namespaces: { eval: evalMessages, shell: shellMessages, cost: costMessages },
  });
  return { ...view, props };
}

const section = (name: string) => screen.getByRole("region", { name });

describe("EvalCaseDrawer — sections", () => {
  it("asks the API for the case, with the suite when the URL names one", async () => {
    renderDrawer({ suiteId: UUID2 });
    await screen.findByRole("dialog");
    await screen.findByText("Summary");
    expect(h.get).toHaveBeenCalledWith(`/eval-cases/c1?suite_id=${UUID2}`, expect.anything());
  });

  it("header: name, outcome chip, suite line with stale and single-case markers", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "stripe-key-leak" });
    expect((await within(dialog).findAllByText("flaky")).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Full · Strict reviewer · skill v3")).toBeInTheDocument();
    expect(within(dialog).getAllByText("stale").length).toBeGreaterThan(0);
  });

  it("summary: expected / matched / unexpected and both arm tallies", async () => {
    renderDrawer();
    const summary = within(await screen.findByRole("region", { name: "Summary" }));
    expect(summary.getByText("Expected").nextSibling).toHaveTextContent("2");
    expect(summary.getByText("Matched").nextSibling).toHaveTextContent("1");
    expect(summary.getByText("Unexpected").nextSibling).toHaveTextContent("1");
    expect(summary.getByText("2/3 passed")).toBeInTheDocument();
    expect(summary.getByText("0/3 passed")).toBeInTheDocument();
  });

  it("runs: a row per arm and repeat with result, matched, duration, cost and the error text", async () => {
    renderDrawer();
    await screen.findByText("Summary");
    const runs = within(section("Runs"));
    const rows = runs.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(7); // 6 runs + the failed run's error line
    expect(within(rows[0]!).getByText("pass")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("1/2")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("1.2s")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("$0.010")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("fail")).toBeInTheDocument();
    expect(within(rows[4]!).getByText("error")).toBeInTheDocument();
    expect(runs.getByText("Timed out after 1560s")).toBeInTheDocument();
  });

  it("expectations: must_find rows marked matched, partial or missed", async () => {
    renderDrawer();
    await screen.findByText("Summary");
    const list = within(section("Expectations"));
    expect(list.getByText("src/config.ts")).toBeInTheDocument();
    expect(list.getByText("matched 2/3")).toBeInTheDocument();
    expect(list.getByText("missed")).toBeInTheDocument();
    expect(list.getByText("lines 10–12")).toBeInTheDocument();
    expect(list.getByText("contains “retry”")).toBeInTheDocument();
  });

  it("hides matched/missed marks and says why when the case was edited after the suite", async () => {
    answer = () => ({ ...DETAIL, expectation_changed: true });
    renderDrawer();
    await screen.findByText("Summary");
    expect(screen.getByText(/edited after that suite ran/)).toBeInTheDocument();
    expect(within(section("Expectations")).queryByText(/matched/)).not.toBeInTheDocument();
  });

  it("unexpected findings per run", async () => {
    renderDrawer();
    await screen.findByText("Summary");
    const un = within(section("Unexpected findings"));
    expect(un.getByText("Unused retry")).toBeInTheDocument();
    expect(un.getByText("src/extra.ts:7")).toBeInTheDocument();
    expect(un.getByText("1 more finding not listed")).toBeInTheDocument();
  });

  it("input: PR source, files, and a collapsible diff preview", async () => {
    renderDrawer();
    await screen.findByText("Summary");
    const input = within(section("Input"));
    expect(input.getByText("PR #42")).toBeInTheDocument();
    expect(input.getByText("2 files")).toBeInTheDocument();
    expect(input.queryByText(/sk_live_x/)).not.toBeInTheDocument();
    fireEvent.click(input.getByRole("button", { name: /Diff preview/ }));
    expect(await input.findByText(/sk_live_x/)).toBeInTheDocument();
    expect(input.getByText("Showing the first 24 of 5,000 characters.")).toBeInTheDocument();
  });

  it("history: shows the suites of this case and switches the suite on click", async () => {
    const { props } = renderDrawer();
    await screen.findByText("Summary");
    const history = within(section("History"));
    const items = history.getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(history.getByText("single-case run")).toBeInTheDocument();
    fireEvent.click(items[1]!);
    expect(props.onSelectSuite).toHaveBeenCalledWith(UUID2);
  });

  it("a case that never ran says so, with no runs or history", async () => {
    answer = () => ({
      ...DETAIL,
      suite: null,
      outcome: null,
      history: [],
      arms: { with: { passed: 0, total: 0, matched_median: null, unexpected_median: null, runs: [] }, without: { passed: 0, total: 0, matched_median: null, unexpected_median: null, runs: [] } },
    });
    renderDrawer();
    expect(await screen.findByText(/has not run yet/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Runs" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Expectations" })).toBeInTheDocument();
  });

  it("a load error shows a message instead of sections", async () => {
    answer = () => new ApiError("nope", 404);
    renderDrawer();
    expect(await screen.findByText("Could not load this case.")).toBeInTheDocument();
  });
});

describe("EvalCaseDrawer — actions and close", () => {
  it("footer: Run this case, Edit, Delete; close button", async () => {
    const { props } = renderDrawer();
    await screen.findByText("Summary");
    fireEvent.click(screen.getByRole("button", { name: "Run this case" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onRun).toHaveBeenCalledTimes(1);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Run this case is disabled, with the reason, while a suite is running", async () => {
    renderDrawer({ runBlockedTitle: "A suite is already running." });
    await screen.findByText("Summary");
    const btn = screen.getByRole("button", { name: "Run this case" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "A suite is already running.");
  });
});

describe("EvalCaseDrawer — polling", () => {
  it("polls while the suite runs and stops once it is terminal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = { ...DETAIL, suite: { ...DETAIL.suite!, status: "running" } };
    let calls = 0;
    answer = () => (++calls >= 3 ? DETAIL : running);
    renderDrawer();
    await screen.findByText("Summary");
    expect(h.get).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS));
    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS));
    expect(h.get).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS * 3));
    expect(h.get).toHaveBeenCalledTimes(3);
  });
});
