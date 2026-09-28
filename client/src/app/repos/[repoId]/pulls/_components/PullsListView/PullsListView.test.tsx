/**
 * PullsListView — wiring between the URL (?status=), the view state (query,
 * sort) and the pure `filterAndSortPulls`. The row, the shell and the data
 * hooks are faked: the list logic itself is covered in helpers.test.ts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PrMeta } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import prReviewMessages from "../../../../../../../messages/en/prReview.json";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
  pulls: undefined as PrMeta[] | undefined,
  repoNotFound: false,
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => h.search,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <p>repo-not-found</p>,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/api" } }),
  useRepoNotFound: () => h.repoNotFound,
}));
vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({
    data: h.pulls,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRefreshRepo: () => ({ mutate: h.refresh, isPending: false }),
}));
vi.mock("../PRRow", () => ({
  PRRow: ({ pr }: { pr: PrMeta }) => <div data-testid="pr-row">{pr.title}</div>,
}));

import { PullsListView } from "./PullsListView";

function pr(number: number, o: Partial<PrMeta>): PrMeta {
  return {
    id: `pr-${number}`,
    number,
    title: `PR ${number}`,
    author: "vlad",
    branch: "b",
    base: "main",
    head_sha: "abc",
    additions: 1,
    deletions: 1,
    files_count: 1,
    status: "needs_review",
    opened_at: "2026-06-01T00:00:00.000Z",
    updated_at: `2026-06-0${number}T00:00:00.000Z`,
    score: null,
    last_review_findings: null,
    last_run_cost_usd: null,
    last_run_cost_source: null,
    last_run_cost_missing_reason: null,
    ...o,
  };
}

const PULLS = [
  pr(1, { title: "Fix login", status: "needs_review" }),
  pr(2, { title: "Add cost badge", status: "needs_review" }),
  pr(3, { title: "Bump deps", status: "reviewed" }),
  pr(4, { title: "Old thing", status: "merged" }),
];

const rowTitles = () => screen.queryAllByTestId("pr-row").map((el) => el.textContent);
const renderView = () =>
  renderWithProviders(<PullsListView repoId="repo-1" />, {
    namespaces: { prReview: prReviewMessages },
  });

beforeEach(() => {
  h.replace.mockClear();
  h.refresh.mockClear();
  h.search = new URLSearchParams();
  h.pulls = PULLS;
  h.repoNotFound = false;
});
afterEach(cleanup);

describe("PullsListView", () => {
  it("defaults to the needs-review filter, newest first, and summarises the whole list", () => {
    renderView();
    expect(rowTitles()).toEqual(["Add cost badge", "Fix login"]);
    expect(screen.getByText("3 open · 2 need review")).toBeInTheDocument();
  });

  it("shows every PR for ?status=all", () => {
    h.search = new URLSearchParams("status=all");
    renderView();
    expect(rowTitles()).toEqual(["Old thing", "Bump deps", "Add cost badge", "Fix login"]);
  });

  it("writes the picked status into the URL, keeping the other params", () => {
    h.search = new URLSearchParams("status=all&x=1");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Reviewed" }));
    expect(h.replace).toHaveBeenCalledWith("/repos/repo-1/pulls?status=reviewed&x=1");
  });

  it("filters by the search box and re-sorts on request", () => {
    h.search = new URLSearchParams("status=all");
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Filter pull requests…"), {
      target: { value: "i" },
    });
    expect(rowTitles()).toEqual(["Old thing", "Fix login"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "oldest" } });
    expect(rowTitles()).toEqual(["Fix login", "Old thing"]);
  });

  it("shows the per-status empty state when nothing matches", () => {
    h.search = new URLSearchParams("status=stale");
    renderView();
    expect(rowTitles()).toEqual([]);
    expect(screen.getByText("No pull requests")).toBeInTheDocument();
  });

  it("shows RepoNotFound for a :repoId that is not in the workspace", () => {
    h.repoNotFound = true;
    renderView();
    expect(screen.getByText("repo-not-found")).toBeInTheDocument();
    expect(rowTitles()).toEqual([]);
  });

  it("refreshes the current repo", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(h.refresh).toHaveBeenCalledWith("repo-1");
  });
});
