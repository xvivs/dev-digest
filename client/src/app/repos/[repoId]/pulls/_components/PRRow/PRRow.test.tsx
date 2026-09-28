/**
 * PRRow — the COST and FINDINGS columns. Both render a dash in their "nothing
 * to show" state, so every assertion here is scoped to one cell (by tooltip for
 * cost, by the popover for findings) rather than to the row's only dash.
 *
 * `@/components/severity-icons` and `@/components/findings-popover` are faked:
 * this suite is about the row, not about how those two render.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PrMeta } from "@/lib/types";
import type { FindingRecord, Severity, SeverityCounts } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../messages/en/prReview.json";
import costMessages from "../../../../../../../messages/en/cost.json";
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
  // Arms on mouseOver, the way the real popover's open timer does.
  FindingsPopover: ({
    children,
    total,
    findings,
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
      data-preview={(findings ?? []).map((f) => f.title).join("|")}
      onMouseOver={() => onArm?.()}
    >
      {children}
    </span>
  ),
}));

import { PRRow } from "./PRRow";

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add cost badge",
    author: "vlad",
    branch: "feature/cost-badge",
    base: "main",
    head_sha: "abc1234",
    additions: 40,
    deletions: 10,
    files_count: 3,
    status: "needs_review",
    opened_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
    score: null,
    last_review_findings: null,
    last_run_cost_usd: null,
    last_run_cost_source: null,
    last_run_cost_missing_reason: null,
    ...o,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushMock.mockClear();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderRow(meta: PrMeta) {
  // The FINDINGS cell holds a lazy React Query subscription, so the row now
  // needs a QueryClient in scope even when nothing is ever fetched.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{
          prReview: prReviewMessages,
          cost: costMessages,
          findings: findingsMessages,
        }}
      >
        <PRRow pr={meta} repoId="repo-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PRRow — cost column", () => {
  it("renders the last run's cost", () => {
    renderRow(pr({ last_run_cost_usd: 0.0013, last_run_cost_source: "provider" }));
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("renders a dash for a PR that has never been run", () => {
    renderRow(pr({ score: 87 }));
    // Scoped by tooltip: SCORE, FINDINGS and COST all render a bare dash.
    expect(screen.getByTitle("Cost unavailable.")).toHaveTextContent("—");
  });
});

describe("PRRow — findings column", () => {
  it("renders a dash and no popover for a PR that has never been reviewed", () => {
    renderRow(pr({ score: 87, last_run_cost_usd: 0.0013 }));
    expect(screen.queryByTestId("findings-popover")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("renders the severity tally and only asks for the findings once a row is hovered", async () => {
    renderRow(
      pr({ score: 87, last_review_findings: { critical: 1, warning: 2, suggestion: 0 } }),
    );

    expect(screen.getByRole("button", { name: "CRITICAL 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WARNING 2" })).toBeInTheDocument();
    expect(screen.getByTestId("findings-popover")).toHaveAttribute("data-total", "3");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.mouseOver(screen.getByTestId("findings-popover"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/pulls/pr-1/reviews");
  });

  it("routes a severity click to the filtered findings tab instead of the PR itself", () => {
    renderRow(
      pr({ score: 87, last_review_findings: { critical: 1, warning: 2, suggestion: 0 } }),
    );

    fireEvent.click(screen.getByRole("button", { name: "CRITICAL 1" }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      "/repos/repo-1/pulls/482?tab=findings&severity=CRITICAL",
    );
    expect(pushMock).not.toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });

  it("still opens the PR when the row is clicked outside the findings cell", () => {
    renderRow(pr({ score: 87 }));
    fireEvent.click(screen.getByText("Add cost badge"));
    expect(pushMock).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });
});
