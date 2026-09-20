/**
 * PRRow — COST column. The cell shows the last run's cost, or a dash for a PR
 * that has never been run (no cost row to derive it from).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import prReviewMessages from "../../../../../../../messages/en/prReview.json";
import costMessages from "../../../../../../../messages/en/cost.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PRRow } from "./PRRow";

afterEach(cleanup);

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
    last_run_cost_usd: null,
    last_run_cost_source: null,
    last_run_cost_missing_reason: null,
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, cost: costMessages }}>
      <PRRow pr={meta} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — cost column", () => {
  it("renders the last run's cost", () => {
    renderRow(pr({ last_run_cost_usd: 0.0013, last_run_cost_source: "provider" }));
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("renders a dash for a PR that has never been run", () => {
    // score set so the SCORE cell doesn't also render "—" — this test is about COST only.
    renderRow(pr({ score: 87 }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
