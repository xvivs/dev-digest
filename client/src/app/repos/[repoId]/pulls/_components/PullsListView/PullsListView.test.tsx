/**
 * PullsListView — wiring between the URL (?status=), the view state (query,
 * sort) and the pure `filterAndSortPulls`. The list logic itself is covered in
 * helpers.test.ts; this suite renders the real AppShell, RepoNotFound and
 * PRRow, faking only data hooks, the API and next/navigation.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { PrMeta } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import prReviewMessages from "../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import commonMessages from "../../../../../../../messages/en/common.json";
import costMessages from "../../../../../../../messages/en/cost.json";
import findingsMessages from "../../../../../../../messages/en/findings.json";

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
  usePathname: () => "/repos/repo-1/pulls",
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo-1",
    setRepoId: vi.fn(),
    repos: [],
    activeRepo: { id: "repo-1", full_name: "acme/api", default_branch: "main", last_polled_at: null },
    reposLoaded: true,
  }),
  useRepoNotFound: () => h.repoNotFound,
}));
// AppShell's useShellContext also calls usePulls (for the sidebar's PR-count
// badge) and useDeleteRepo (repo removal) — keep the real implementations for
// those and override only what this screen itself reads.
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    usePulls: () => ({
      data: h.pulls,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    useRefreshRepo: () => ({ mutate: h.refresh, isPending: false }),
  };
});

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

// PRRow renders the title as a real link to the PR route — scope to that
// href pattern so AppShell's own links (sidebar nav, repo switcher) never
// leak into the count.
const rowTitles = () =>
  screen
    .getAllByRole("link")
    .filter((el) => /^\/repos\/repo-1\/pulls\/\d+$/.test(el.getAttribute("href") ?? ""))
    .map((el) => el.textContent);
const renderView = () =>
  renderWithProviders(<PullsListView repoId="repo-1" />, {
    namespaces: {
      prReview: prReviewMessages,
      shell: shellMessages,
      common: commonMessages,
      cost: costMessages,
      findings: findingsMessages,
    },
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
    expect(screen.getByText(commonMessages.repoNotFound.title)).toBeInTheDocument();
    expect(rowTitles()).toEqual([]);
  });

  it("refreshes the current repo", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(h.refresh).toHaveBeenCalledWith("repo-1");
  });
});
