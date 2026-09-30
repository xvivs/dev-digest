/**
 * DiffTab — Smart Diff end to end on the client: roles from the smart-diff
 * route, every finding mark from usePrReviews. Real hooks + a real QueryClient;
 * only `api` is faked, and its `get` parses through the schema it is given (a
 * plain mock would skip ADR 0007 response validation).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReview from "@/../messages/en/prReview.json";
import diffViewer from "@/../messages/en/diffViewer.json";
import { renderWithProviders } from "@/test/render";

type Route = unknown | Error;
const routes: Record<string, Route> = {};

const get = vi.fn(async (path: string, schema?: { parse: (v: unknown) => unknown }) => {
  if (!(path in routes)) throw new Error(`unmocked GET ${path}`);
  const value = routes[path];
  if (value instanceof Error) throw value;
  return schema ? schema.parse(value) : value;
});
const post = vi.fn(async (path: string, _body?: unknown) => {
  if (path === "/findings/f1/accept") {
    const reviews = routes["/pulls/pr-1/reviews"] as ReviewRecord[];
    routes["/pulls/pr-1/reviews"] = reviews.map((r) => ({
      ...r,
      findings: r.findings.map((f) => (f.id === "f1" ? { ...f, accepted_at: "2026-09-30T10:00:00Z" } : f)),
    }));
    return { finding: {} };
  }
  throw new Error(`unmocked POST ${path}`);
});
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      get: (path: string, schema?: { parse: (v: unknown) => unknown }) => get(path, schema),
      post: (path: string, body?: unknown) => post(path, body),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    },
  };
});

import { DiffTab } from "./DiffTab";

const PATCH = "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;";
const FILES: PrFile[] = [
  { path: "src/a.ts", additions: 2, deletions: 1, patch: PATCH },
  { path: "src/a.test.ts", additions: 1, deletions: 0, patch: PATCH },
  { path: "README.md", additions: 1, deletions: 0, patch: PATCH },
];

const smartDiff = (): SmartDiff => ({
  groups: [
    { role: "core", files: [{ path: "src/a.ts", additions: 2, deletions: 1, finding_lines: [3] }] },
    { role: "tests", files: [{ path: "src/a.test.ts", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "wiring", files: [] },
    { role: "docs", files: [{ path: "README.md", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "boilerplate", files: [] },
  ],
  split_suggestion: { too_big: false, total_lines: 5, proposed_splits: [] },
});

const review = (): ReviewRecord => ({
  id: "rev-1",
  pr_id: "pr-1",
  agent_id: "a1",
  run_id: null,
  kind: "review",
  verdict: null,
  summary: null,
  score: null,
  model: null,
  created_at: "2026-09-30T09:00:00Z",
  findings: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "bug",
      title: "Boundary untested",
      file: "src/a.ts",
      start_line: 3,
      end_line: 3,
      rationale: "Needs a test.",
      suggestion: null,
      confidence: 0.9,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rev-1",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
});

const comment = {
  id: 1,
  path: "src/a.ts",
  line: 3,
  original_line: 3,
  side: "RIGHT",
  body: "looks good",
  user: "octocat",
  created_at: "2026-09-01T10:00:00Z",
  html_url: "https://github.com/acme/api/pull/1#discussion_r1",
  in_reply_to_id: null,
  is_outdated: false,
};

function setRoutes(over: Record<string, Route> = {}) {
  for (const k of Object.keys(routes)) delete routes[k];
  Object.assign(routes, {
    "/pulls/pr-1/comments": [],
    "/pulls/pr-1/reviews": [review()],
    "/pulls/pr-1/smart-diff": smartDiff(),
    ...over,
  });
}

function renderTab() {
  return renderWithProviders(<DiffTab prId="pr-1" headSha="sha-1" files={FILES} canComment={false} />, {
    namespaces: { prReview, diffViewer },
  });
}

beforeEach(() => setRoutes());
afterEach(() => {
  cleanup();
  get.mockClear();
  post.mockClear();
});

const sectionOf = (label: string) => screen.getByText(label).closest("section")!;

describe("DiffTab", () => {
  it("groups by role in the fixed order, mutes empty groups, and keeps docs collapsed", async () => {
    const { container } = renderTab();
    await screen.findByText("Core logic");
    const text = container.textContent ?? "";
    const order = ["Core logic", "Tests", "Wiring", "Docs", "Boilerplate"].map((l) => text.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const wiring = sectionOf("Wiring");
    expect(within(wiring).getByText("0 files")).toBeInTheDocument();
    expect(wiring.querySelector("[aria-expanded]")).toBeNull();
    expect(wiring.querySelector("button")).toBeNull();

    const docsToggle = within(sectionOf("Docs")).getAllByRole("button")[0]!;
    expect(docsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    expect(within(sectionOf("Core logic")).getByRole("img", { name: "1 file with findings" })).toBeInTheDocument();
    expect(within(sectionOf("Tests")).queryByRole("img", { name: /with findings/ })).toBeNull();
  });

  it("switches to Original order (flat, pr.files order) and back", async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText("Core logic");
    const smart = screen.getByRole("button", { name: "Smart order" });
    const original = screen.getByRole("button", { name: "Original order" });
    expect(smart).toHaveAttribute("aria-pressed", "true");

    await user.click(original);
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(smart).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    const paths = screen.getAllByText(/^(src\/a\.ts|src\/a\.test\.ts|README\.md)$/).map((n) => n.textContent);
    expect(paths).toEqual(["src/a.ts", "src/a.test.ts", "README.md"]);

    await user.click(smart);
    expect(await screen.findByText("Core logic")).toBeInTheDocument();
  });

  it("shows the finding card under its line; Accept posts with prId and refetches the reviews", async () => {
    const user = userEvent.setup();
    renderTab();
    const card = await screen.findByText("Boundary untested");
    const row = within(sectionOf("Core logic")).getByText("const c = 4;").closest("div")!.parentElement!;
    expect(row).toContainElement(card);

    const before = get.mock.calls.filter(([p]) => p === "/pulls/pr-1/reviews").length;
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(post).toHaveBeenCalledWith("/findings/f1/accept", undefined);
    await waitFor(() =>
      expect(get.mock.calls.filter(([p]) => p === "/pulls/pr-1/reviews").length).toBeGreaterThan(before),
    );
    expect(await screen.findByText("accepted")).toBeInTheDocument();
  });

  it("says the review has not run, shows no counter, then updates without a remount", async () => {
    setRoutes({ "/pulls/pr-1/reviews": [] });
    const { queryClient } = renderTab();
    expect(await screen.findByText("Review not run yet — findings will appear here")).toBeInTheDocument();
    await screen.findByText("Core logic");
    expect(screen.queryByRole("img", { name: /with findings/ })).toBeNull();

    queryClient.setQueryData(["reviews", "pr-1"], [review()]);
    expect(await screen.findByRole("img", { name: "1 file with findings" })).toBeInTheDocument();
    expect(screen.queryByText("Review not run yet — findings will appear here")).toBeNull();
  });

  it("falls back to the flat list and disables Smart order when grouping fails", async () => {
    setRoutes({ "/pulls/pr-1/smart-diff": new Error("boom") });
    renderTab();
    expect(await screen.findByText("Couldn’t group files by role; showing the original order.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smart order" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
  });

  it("toggles comments and findings together", async () => {
    setRoutes({ "/pulls/pr-1/comments": [comment] });
    const user = userEvent.setup();
    renderTab();
    await screen.findByText("Boundary untested");
    expect(screen.queryByText("looks good")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all (2)" }));
    expect(await screen.findByText("looks good")).toBeInTheDocument();
    expect(screen.getByText("Boundary untested")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide comments & findings (2)" }));
    expect(screen.queryByText("looks good")).not.toBeInTheDocument();
    expect(screen.queryByText("Boundary untested")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show comments & findings (2)" })).toBeInTheDocument();
  });

  it("without comments the untouched toggle already shows findings, and the first click hides them", async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText("Boundary untested");
    await user.click(await screen.findByRole("button", { name: "Hide comments & findings (1)" }));
    expect(screen.queryByText("Boundary untested")).not.toBeInTheDocument();
  });

  it("puts a finding on a path outside the PR in a block after the groups", async () => {
    const r = review();
    r.findings.push({ ...r.findings[0]!, id: "f2", title: "Stray", file: "old/name.ts" });
    setRoutes({ "/pulls/pr-1/reviews": [r] });
    renderTab();
    expect(await screen.findByText("1 finding on files not in this diff")).toBeInTheDocument();
    expect(screen.getByText("Stray")).toBeInTheDocument();
  });
});
