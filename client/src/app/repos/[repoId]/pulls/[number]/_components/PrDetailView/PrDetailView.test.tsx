/**
 * PrDetailView — the screen renders from hook state alone, and starting a
 * review refreshes each run query exactly once. Before the move out of
 * page.tsx the route invalidated `["pr-active-runs", prId]` by hand on top of
 * `useRunReview`'s own invalidation, so every start refetched it twice.
 *
 * Real hooks + a real QueryClient; only the network (`api`), the router and
 * the chrome (AppShell, repo context) are stubbed.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import prReview from "@/../messages/en/prReview.json";
import cost from "@/../messages/en/cost.json";
import findings from "@/../messages/en/findings.json";
import diffViewer from "@/../messages/en/diffViewer.json";
import common from "@/../messages/en/common.json";
import { renderWithProviders } from "@/test/render";

let search = new URLSearchParams("tab=findings");
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => search,
  usePathname: () => "/repos/repo-1/pulls/482",
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

let repoNotFound = false;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/payments-api" }, repos: [], reposLoaded: true }),
  useRepoNotFound: () => repoNotFound,
}));

const PR = {
  id: "pr-uuid",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "dana",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc1234",
  additions: 12,
  deletions: 3,
  files_count: 2,
  status: "open",
  body: "Adds a token bucket.",
  files: [],
  commits: [],
};

const REVIEW = {
  id: "rev-1",
  pr_id: "pr-uuid",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: "Secret committed.",
  score: 40,
  model: "m",
  grounding: null,
  created_at: "2026-09-20T18:45:10.000Z",
  findings: [],
};

const routes: Record<string, unknown> = {
  "/repos/repo-1/pulls": [{ ...PR, files: undefined, commits: undefined, body: undefined }],
  "/pulls/pr-uuid": PR,
  "/pulls/pr-uuid/reviews": [REVIEW],
  "/pulls/pr-uuid/runs/active": [],
  "/pulls/pr-uuid/runs": [],
  "/agents": [{ id: "a1", name: "Security", model: "gpt-4.1", enabled: true }],
};

const get = vi.fn(async (path: string) => {
  if (!(path in routes)) throw new Error(`unmocked GET ${path}`);
  return routes[path];
});
const post = vi.fn(async (_path: string, _body?: unknown) => ({ runs: [{ run_id: "run-2" }] }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      get: (path: string) => get(path),
      post: (path: string, body?: unknown) => post(path, body),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    },
  };
});

import { PrDetailView } from "./PrDetailView";

afterEach(() => {
  cleanup();
  get.mockClear();
  search = new URLSearchParams("tab=findings");
  repoNotFound = false;
  replace.mockReset();
  post.mockClear();
});

function renderView() {
  return renderWithProviders(<PrDetailView repoId="repo-1" number="482" />, {
    namespaces: { prReview, cost, findings, diffViewer, common },
  });
}

/** How many times the network saw `GET <path>` so far. */
const gets = (path: string) => get.mock.calls.filter(([p]) => p === path).length;

describe("PrDetailView", () => {
  it("renders the PR header and the tab from ?tab= once the hooks resolve", async () => {
    renderView();
    expect(await screen.findByText("Add rate limiting to public API endpoints")).toBeInTheDocument();
    // ?tab=findings → the runs tab body, with the review from usePrReviews.
    expect(screen.getByText("Review runs")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Security Reviewer/ })).toBeInTheDocument();
  });

  it("starting a review switches to the runs tab and refetches each run query exactly once", async () => {
    search = new URLSearchParams("tab=overview");
    renderView();
    expect(await screen.findByText("Adds a token bucket.")).toBeInTheDocument();
    await waitFor(() => expect(gets("/pulls/pr-uuid/runs/active")).toBeGreaterThan(0));
    const before = {
      active: gets("/pulls/pr-uuid/runs/active"),
      runs: gets("/pulls/pr-uuid/runs"),
      reviews: gets("/pulls/pr-uuid/reviews"),
    };

    fireEvent.click(screen.getByRole("button", { name: /Run Review/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Run all enabled agents/ }));

    expect(replace).toHaveBeenCalledWith("/repos/repo-1/pulls/482?tab=findings");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/pulls/pr-uuid/review", { all: true }));
    // What the user pays for: one network refetch per run query, not two.
    await waitFor(() => expect(gets("/pulls/pr-uuid/runs/active")).toBe(before.active + 1));
    await waitFor(() => expect(gets("/pulls/pr-uuid/runs")).toBe(before.runs + 1));
    await waitFor(() => expect(gets("/pulls/pr-uuid/reviews")).toBe(before.reviews + 1));
  });

  it("shows the stale-repo empty state instead of fetching the PR", () => {
    repoNotFound = true;
    renderView();
    expect(screen.queryByText("Review runs")).not.toBeInTheDocument();
    expect(screen.getByText(common.repoNotFound.title)).toBeInTheDocument();
  });
});
