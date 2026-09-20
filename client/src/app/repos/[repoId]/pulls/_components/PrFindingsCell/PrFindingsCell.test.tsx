/**
 * PrFindingsCell — the FINDINGS column of a PR list row.
 *
 * `@/components/severity-icons` and `@/components/findings-popover` are faked
 * here on purpose: this suite is about what the CELL decides (dash vs popover,
 * when the fetch is allowed to run, which review row feeds the preview, where a
 * severity click navigates), not about how those two render.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  FindingRecord,
  PrMeta,
  ReviewRecord,
  Severity,
  SeverityCounts,
} from "@devdigest/shared";
import findingsMessages from "../../../../../../../messages/en/findings.json";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/severity-icons", () => ({
  ZERO_COUNTS: { critical: 0, warning: 0, suggestion: 0 },
  countBySeverity: () => ({ critical: 0, warning: 0, suggestion: 0 }),
  SeverityIcons: ({
    counts,
    onSelect,
  }: {
    counts: SeverityCounts;
    onSelect?: (s: Severity) => void;
  }) => (
    <span data-testid="severity-icons">
      {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) => {
        const n = counts[sev.toLowerCase() as keyof SeverityCounts];
        return n === 0 ? null : (
          <button key={sev} type="button" onClick={() => onSelect?.(sev)}>
            {`${sev} ${n}`}
          </button>
        );
      })}
    </span>
  ),
}));

vi.mock("@/components/findings-popover", () => ({
  PREVIEW_LIMIT: 3,
  // Stands in for the real popover: it exposes every prop the cell computes as
  // a data-attribute, and arms on mouseOver the way the real open timer does.
  FindingsPopover: ({
    children,
    total,
    findings,
    loading,
    error,
    runLinked,
    onArm,
  }: {
    children: ReactNode;
    total: number;
    findings: FindingRecord[] | undefined;
    loading?: boolean;
    error?: boolean;
    runLinked: boolean;
    onArm?: () => void;
  }) => (
    <span
      data-testid="findings-popover"
      data-total={String(total)}
      data-loading={loading ? "yes" : "no"}
      data-error={error ? "yes" : "no"}
      data-run-linked={runLinked ? "yes" : "no"}
      data-preview={(findings ?? []).map((f) => f.title).join("|")}
      onMouseOver={() => onArm?.()}
    >
      {children}
    </span>
  ),
}));

import { PrFindingsCell } from "./PrFindingsCell";

// ---- fixtures -------------------------------------------------------------

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add findings column",
    author: "vlad",
    branch: "feature/findings-column",
    base: "main",
    head_sha: "abc1234",
    additions: 40,
    deletions: 10,
    files_count: 3,
    status: "needs_review",
    opened_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
    score: 72,
    last_review_findings: null,
    last_run_cost_usd: null,
    last_run_cost_source: null,
    last_run_cost_missing_reason: null,
    ...o,
  };
}

function finding(o: Partial<FindingRecord> & { id: string; title: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "bug",
    file: "src/index.ts",
    start_line: 10,
    end_line: 12,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev-review",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> & { id: string; kind: ReviewRecord["kind"] }): ReviewRecord {
  return {
    pr_id: "pr-1",
    agent_id: "ag-1",
    run_id: null,
    agent_name: "Security Reviewer",
    verdict: "comment",
    summary: null,
    score: 72,
    model: "gpt-4.1",
    grounding: null,
    created_at: "2026-06-10T00:00:00.000Z",
    findings: [],
    ...o,
  };
}

/** `/pulls/:id/reviews` does not filter by kind — the summary row comes first. */
const REVIEWS: ReviewRecord[] = [
  review({ id: "rev-summary", kind: "summary", run_id: "run-summary" }),
  review({
    id: "rev-review",
    kind: "review",
    run_id: "run-9",
    findings: [finding({ id: "f1", title: "Unbounded loop" })],
  }),
];

const COUNTS: SeverityCounts = { critical: 1, warning: 2, suggestion: 0 };

// ---- harness --------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushMock.mockClear();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => REVIEWS,
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCell(meta: PrMeta, onRowClick?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
        {/* stands in for the clickable PR row that wraps the cell */}
        <div onClick={onRowClick}>
          <PrFindingsCell pr={meta} repoId="repo-1" />
        </div>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---- tests ----------------------------------------------------------------

describe("PrFindingsCell", () => {
  it("shows a plain dash — and no popover — for a PR with nothing to show", () => {
    // never reviewed
    renderCell(pr({ last_review_findings: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByTestId("findings-popover")).not.toBeInTheDocument();
    cleanup();

    // reviewed, but the review found nothing
    renderCell(pr({ last_review_findings: { critical: 0, warning: 0, suggestion: 0 } }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByTestId("findings-popover")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("holds the findings request until the popover arms, then previews the review row", async () => {
    renderCell(pr({ last_review_findings: COUNTS }));

    const popover = screen.getByTestId("findings-popover");
    // The tally comes from PrMeta, so it is on screen with no request at all.
    expect(popover).toHaveAttribute("data-total", "3");
    expect(screen.getByRole("button", { name: "CRITICAL 1" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    // A query parked at `enabled: false` stays isPending forever — the cell must
    // read isFetching instead, or every row would show a spinner on load.
    expect(popover).toHaveAttribute("data-loading", "no");

    fireEvent.mouseOver(popover);

    await waitFor(() =>
      expect(screen.getByTestId("findings-popover")).toHaveAttribute(
        "data-preview",
        "Unbounded loop",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/pulls/pr-1/reviews");
    // run_id comes off the same `kind: 'review'` row the preview came from.
    expect(screen.getByTestId("findings-popover")).toHaveAttribute("data-run-linked", "yes");
  });

  it("sends a severity click to the filtered findings tab, not to the row's own route", () => {
    const rowClick = vi.fn();
    renderCell(pr({ last_review_findings: COUNTS }), rowClick);

    fireEvent.click(screen.getByRole("button", { name: "CRITICAL 1" }));

    expect(pushMock).toHaveBeenCalledWith(
      "/repos/repo-1/pulls/482?tab=findings&severity=CRITICAL",
    );
    expect(rowClick).not.toHaveBeenCalled();
  });
});
