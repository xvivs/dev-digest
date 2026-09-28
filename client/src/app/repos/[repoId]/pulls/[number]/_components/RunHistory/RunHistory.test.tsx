/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 *
 * Second concern here: the severity strip that REPLACED the "N finding(s)" text.
 * It only appears for runs the tab could resolve to a review — a chip with no
 * review behind it would be a button that goes nowhere.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary, Severity, SeverityCounts } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import costMessages from "../../../../../../../../messages/en/cost.json";
import findingsMessages from "../../../../../../../../messages/en/findings.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    cost_source: null,
    cost_missing_reason: null,
    ...o,
  };
}

function finding(o: Partial<FindingRecord> & { id: string; severity: Severity }): FindingRecord {
  return {
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function renderRuns(
  runs: RunSummary[],
  extra: {
    findingsByRun?: ReadonlyMap<string, FindingRecord[]>;
    countsByRun?: ReadonlyMap<string, SeverityCounts>;
    onGoToReview?: (runId: string, severity?: Severity) => void;
    onOpenTrace?: (runId: string) => void;
    onDelete?: (runId: string) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: messages, cost: costMessages, findings: findingsMessages }}
    >
      <RunHistory runs={runs} onOpenTrace={() => {}} {...extra} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — cost + tokens", () => {
  it("a done run shows its token total and provider cost in the timeline row", () => {
    renderRuns([
      run({
        status: "done",
        tokens_in: 9000,
        tokens_out: 119,
        cost_usd: 0.0013,
        cost_source: "provider",
      }),
    ]);
    expect(screen.getByText(/9,119 tok/)).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("a running run shows a cost dash and no token segment (no tokens accumulated yet)", () => {
    renderRuns([
      run({
        status: "running",
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
        cost_missing_reason: "pending",
        score: null,
        blockers: null,
      }),
    ]);
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("RunHistory — severity strip", () => {
  const counts: ReadonlyMap<string, SeverityCounts> = new Map([
    ["run-1", { critical: 1, warning: 2, suggestion: 0 }],
  ]);
  const findingsByRun: ReadonlyMap<string, FindingRecord[]> = new Map([
    [
      "run-1",
      [
        finding({ id: "f1", severity: "CRITICAL" }),
        finding({ id: "f2", severity: "WARNING" }),
        finding({ id: "f3", severity: "WARNING" }),
      ],
    ],
  ]);

  it("severity chips replace the 'N finding(s)' text; the blockers tail stays", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 1, score: 40 })], {
      countsByRun: counts,
      findingsByRun,
      onGoToReview: () => {},
    });

    expect(screen.queryByText(/finding\(s\)/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 Critical finding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 Warning findings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Suggestion findings/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("clicking a chip asks the tab to open that run filtered to that severity", () => {
    const onGoToReview = vi.fn();
    renderRuns([run({ status: "done", findings_count: 3, blockers: 1, score: 40 })], {
      countsByRun: counts,
      findingsByRun,
      onGoToReview,
    });

    fireEvent.click(screen.getByRole("button", { name: "2 Warning findings" }));
    expect(onGoToReview).toHaveBeenCalledWith("run-1", "WARNING");
  });

  it("a tile with no review behind it renders no severity buttons at all", () => {
    // Failed runs never persist a review, so they never make it into the maps.
    renderRuns([run({ status: "done", findings_count: 3, blockers: 1, score: 40 })], {
      onGoToReview: () => {},
    });

    expect(screen.queryByRole("button", { name: /findings$/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });
});

describe("RunHistory — row click behaviour", () => {
  const counts: ReadonlyMap<string, SeverityCounts> = new Map([
    ["run-1", { critical: 0, warning: 2, suggestion: 0 }],
  ]);
  const findingsByRun: ReadonlyMap<string, FindingRecord[]> = new Map([
    ["run-1", [finding({ id: "f1", severity: "WARNING" }), finding({ id: "f2", severity: "WARNING" })]],
  ]);

  it("clicking the row container opens the trace for that run", () => {
    const onOpenTrace = vi.fn();
    const { container } = renderRuns(
      [run({ status: "done", findings_count: 0, blockers: 0, score: 80 })],
      { onOpenTrace },
    );

    fireEvent.click(container.querySelector('[data-run-id="run-1"]')!);
    expect(onOpenTrace).toHaveBeenCalledWith("run-1");
  });

  it("clicking the delete action deletes the run and does not open the trace", () => {
    const onOpenTrace = vi.fn();
    const onDelete = vi.fn();
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 80 })], {
      onOpenTrace,
      onDelete,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete run" }));
    expect(onDelete).toHaveBeenCalledWith("run-1");
    expect(onOpenTrace).not.toHaveBeenCalled();
  });

  it("clicking a severity chip goes to the review and does not open the trace", () => {
    const onOpenTrace = vi.fn();
    const onGoToReview = vi.fn();
    renderRuns([run({ status: "done", findings_count: 2, blockers: 0, score: 80 })], {
      onOpenTrace,
      onGoToReview,
      countsByRun: counts,
      findingsByRun,
    });

    fireEvent.click(screen.getByRole("button", { name: "2 Warning findings" }));
    expect(onGoToReview).toHaveBeenCalledWith("run-1", "WARNING");
    expect(onOpenTrace).not.toHaveBeenCalled();
  });

  it("clicking the agent name button goes to the review and does not open the trace", () => {
    const onOpenTrace = vi.fn();
    const onGoToReview = vi.fn();
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 80 })], {
      onOpenTrace,
      onGoToReview,
    });

    fireEvent.click(screen.getByRole("button", { name: "Security Reviewer" }));
    expect(onGoToReview).toHaveBeenCalledWith("run-1");
    expect(onOpenTrace).not.toHaveBeenCalled();
  });
});

describe("RunHistory — hover styles", () => {
  // React 19 synthesises enter/leave from delegated mouseover/mouseout;
  // `fireEvent.mouseEnter`/`mouseLeave` never reach the handlers (see INSIGHTS.md).
  it("hovering the row swaps the background from elevated to hover, and back on mouse-out", () => {
    const { container } = renderRuns([
      run({ status: "done", findings_count: 0, blockers: 0, score: 80 }),
    ]);
    const row = container.querySelector('[data-run-id="run-1"]') as HTMLElement;

    expect(row.style.background).toBe("var(--bg-elevated)");

    fireEvent.mouseOver(row);
    expect(row.style.background).toBe("var(--bg-hover)");

    fireEvent.mouseOut(row, { relatedTarget: document.body });
    expect(row.style.background).toBe("var(--bg-elevated)");
  });

  it("hovering the delete action colors it critical; hovering the trace action colors it text-primary", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 80 })], {
      onDelete: () => {},
    });

    const deleteBtn = screen.getByRole("button", { name: "Delete run" });
    const traceBtn = screen.getByRole("button", { name: "Open run trace & logs" });

    fireEvent.mouseOver(deleteBtn);
    expect(deleteBtn.style.color).toBe("var(--crit)");
    fireEvent.mouseOut(deleteBtn, { relatedTarget: document.body });

    fireEvent.mouseOver(traceBtn);
    expect(traceBtn.style.color).toBe("var(--text-primary)");
    fireEvent.mouseOut(traceBtn, { relatedTarget: document.body });
  });
});
