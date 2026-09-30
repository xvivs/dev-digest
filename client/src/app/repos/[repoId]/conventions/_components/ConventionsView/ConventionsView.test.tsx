/**
 * ConventionsView — the six page states (AC-32), the tabs and their counts
 * (D8), and the derived selection (AC-39). Only the network is faked (`fetch`,
 * see `@/test/fake-api`): the real hooks, query cache, repo context, cards,
 * header and Create-skill modal run. Two framework boundaries are stubbed:
 * `next/navigation`, and the AppShell chrome (sidebar, palette), which has
 * nothing to do with this screen.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { ConventionCandidate, ConventionsPage } from "@devdigest/shared";
import { RepoProvider } from "@/lib/repo-context";
import { renderWithProviders } from "@/test/render";
import { apiError, json, setupFakeApi } from "@/test/fake-api";
import messages from "../../../../../../../messages/en/conventions.json";
import commonMessages from "../../../../../../../messages/en/common.json";
import costMessages from "../../../../../../../messages/en/cost.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { candidate, createdSkill, page, repo, scan } from "../../fixtures";
import { ConventionsView } from "./ConventionsView";

vi.mock("next/navigation", () => ({
  usePathname: () => "/repos/repo-1/conventions",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const api = setupFakeApi();

/** What the fake server currently holds; tests change it the way the real backend would change. */
const server = {
  page: page(),
  indexStatus: "full",
  indexReason: undefined as string | undefined,
  clonePath: "/clones/x" as string | null,
};

function deferred() {
  let resolve: (r: Response) => void = () => {};
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  server.page = page();
  server.indexStatus = "full";
  server.indexReason = undefined;
  server.clonePath = "/clones/x";

  api.route("GET", "/repos", () => json([repo({ clone_path: server.clonePath })]));
  api.route("GET", "/repos/repo-1/index-state", () =>
    json({
      status: server.indexStatus,
      reason: server.indexReason,
      filesIndexed: 10,
      filesSkipped: 0,
      lastIndexedSha: "abc1234",
      updatedAt: "2026-09-29T09:00:00.000Z",
    }),
  );
  api.route("GET", "/repos/repo-1/conventions", () => json(server.page));
  api.route("GET", "/skills", () => json([]));
  api.route("GET", "/agents", () => json([]));
  api.route("PATCH", "/conventions/:id", ({ params, body }) => {
    const patch = body as Partial<ConventionCandidate>;
    const current = server.page.candidates.find((c) => c.id === params.id);
    if (!current) return apiError(404, "not_found");
    const next: ConventionCandidate = { ...current, ...patch, edited: current.edited || patch.rule !== undefined };
    server.page = { ...server.page, candidates: server.page.candidates.map((c) => (c.id === next.id ? next : c)) };
    return json(next);
  });
  api.route("POST", "/repos/repo-1/resync", () => json({ status: "queued" }, 202));
  api.route("POST", "/repos/repo-1/refresh", () => json(repo({ clone_path: server.clonePath })));
  api.route("POST", "/repos/repo-1/conventions/extract", () => json({ scan_id: "s9" }, 202));
  api.route("POST", "/repos/repo-1/conventions/skills", () => json(createdSkill(), 201));
});
afterEach(cleanup);

const NAMESPACES = { conventions: messages, cost: costMessages, shell: shellMessages, common: commonMessages };

/** Renders the screen and waits until the repo list has landed, so the repo name and clone state are real. */
async function renderView() {
  const user = userEvent.setup();
  renderWithProviders(
    <RepoProvider>
      <ConventionsView repoId="repo-1" />
    </RepoProvider>,
    { namespaces: NAMESPACES },
  );
  await screen.findByRole("heading", { level: 1, name: "Conventions in payments-api" });
  return user;
}

const neverScanned = () => page({ last_scan: null, latest_done_scan: null });
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const cardOf = (rule: string) => screen.getByRole("article", { name: rule });

describe("state 1: never scanned", () => {
  it("offers Run analysis, which starts the extract and moves to the scanning state", async () => {
    server.page = neverScanned();
    api.route("POST", "/repos/repo-1/conventions/extract", () => {
      server.page = page({ running_scan: scan({ id: "s9", status: "running", finished_at: null }) });
      return json({ scan_id: "s9" }, 202);
    });
    const user = await renderView();
    expect(await screen.findByText("No analysis yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run analysis" }));
    expect(await screen.findByText("Scanning the repo…")).toBeInTheDocument();
    expect(api.requestsTo("POST", "/repos/repo-1/conventions/extract")).toHaveLength(1);
  });
});

describe("state 2: repo not indexed", () => {
  beforeEach(() => {
    server.indexStatus = "failed";
    server.page = neverScanned();
  });

  it("offers Index repository and shows no Re-scan when the index is not usable", async () => {
    await renderView();
    expect(await screen.findByText("This repo is not indexed yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index repository" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Re-scan" })).not.toBeInTheDocument();
  });

  it("hides Re-scan when there has been no scan yet, and keeps only Run analysis (B6)", async () => {
    server.indexStatus = "full";
    await renderView();
    expect(await screen.findByRole("button", { name: "Run analysis" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-scan" })).not.toBeInTheDocument();
  });

  it("resyncs on click, keeps the CTA busy while the index is unusable, then moves to never-scanned", async () => {
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Index repository" }));
    expect(api.requestsTo("POST", "/repos/repo-1/resync")).toHaveLength(1);
    // The resync was accepted but the index is still not usable: the CTA stays pending.
    expect(await screen.findByRole("button", { name: "Indexing…" })).toBeDisabled();

    // The index becomes usable on the server; the page finds out by polling the index state.
    api.reply("GET", "/repos/repo-1/index-state", {
      status: "full",
      filesIndexed: 10,
      filesSkipped: 0,
      lastIndexedSha: "def5678",
      updatedAt: "2026-09-29T09:05:00.000Z",
    });
    expect(await screen.findByText("No analysis yet", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Indexing…" })).not.toBeInTheDocument();
  }, 10_000);

  it("drops a stale 'not indexed' extract error once a resync is accepted", async () => {
    server.indexStatus = "full";
    api.route("POST", "/repos/repo-1/conventions/extract", () => apiError(409, "repo_not_indexed", "not indexed"));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Run analysis" }));
    expect(await screen.findByText("This repo is not indexed yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Index repository" }));
    // The index state (full) decides the screen again instead of the old 409.
    expect(await screen.findByText("No analysis yet")).toBeInTheDocument();
    expect(screen.queryByText("This repo is not indexed yet")).not.toBeInTheDocument();
  });

  it("disables the CTA while the resync request is in flight", async () => {
    const resync = deferred();
    api.route("POST", "/repos/repo-1/resync", () => resync.promise);
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Index repository" }));
    expect(await screen.findByRole("button", { name: "Indexing…" })).toBeDisabled();
    resync.resolve(json({ status: "queued" }, 202));
  });

  it("shows the API message inline when the resync fails", async () => {
    api.route("POST", "/repos/repo-1/resync", () => apiError(409, "clone_locked", "Clone is locked"));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Index repository" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start indexing. Clone is locked");
    expect(screen.getByRole("button", { name: "Index repository" })).toBeEnabled();
  });

  it("offers Clone repository, not a re-import hint, when the repo has no clone", async () => {
    server.clonePath = null;
    const user = await renderView();
    expect(await screen.findByText(/This repository is not cloned yet/)).toBeInTheDocument();
    expect(screen.queryByText(/re-import/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Index repository" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clone repository" }));
    expect(api.requestsTo("POST", "/repos/repo-1/refresh")).toHaveLength(1);
  });

  it("polls the repo list and the index state while the clone is missing, then moves on once both arrived (B2)", async () => {
    server.clonePath = null;
    await renderView();
    expect(await screen.findByRole("button", { name: "Clone repository" })).toBeInTheDocument();

    // The clone and the index finish elsewhere (Refresh on the PR list): no click on this page.
    server.clonePath = "/clones/x";
    server.indexStatus = "full";
    expect(await screen.findByText("No analysis yet", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(api.requestsTo("GET", "/repos").length).toBeGreaterThan(1);
    expect(api.requestsTo("GET", "/repos/repo-1/index-state").length).toBeGreaterThan(1);
  }, 10_000);

  it("disables Clone repository and says Cloning… while the request is in flight", async () => {
    server.clonePath = null;
    const refresh = deferred();
    api.route("POST", "/repos/repo-1/refresh", () => refresh.promise);
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Clone repository" }));
    expect(await screen.findByRole("button", { name: "Cloning…" })).toBeDisabled();
    refresh.resolve(json(repo({ clone_path: null })));
  });

  it("keeps the button busy after the clone is accepted until the clone appears", async () => {
    server.clonePath = null;
    api.route("POST", "/repos/repo-1/refresh", () => json(repo({ clone_path: null })));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Clone repository" }));
    // The request is done and the repo list was re-read, but the clone has not shown up.
    await waitFor(() => expect(api.requestsTo("GET", "/repos").length).toBeGreaterThan(1));
    expect(screen.getByRole("button", { name: "Cloning…" })).toBeDisabled();
  });

  it("shows the clone error inline and leaves the button usable", async () => {
    server.clonePath = null;
    api.route("POST", "/repos/repo-1/refresh", () => apiError(409, "clone_locked", "Clone is locked"));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Clone repository" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start cloning. Clone is locked");
    expect(screen.getByRole("button", { name: "Clone repository" })).toBeEnabled();
  });

  it("treats a 409 repo_not_cloned from the extract as not cloned", async () => {
    server.indexStatus = "full";
    api.route("POST", "/repos/repo-1/conventions/extract", () => apiError(409, "repo_not_cloned", "not cloned"));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Run analysis" }));
    expect(await screen.findByText(/This repository is not cloned yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clone repository" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Index repository" })).not.toBeInTheDocument();
  });

  it("also shows it when the extract answers 409 repo_not_indexed", async () => {
    server.indexStatus = "full";
    api.route("POST", "/repos/repo-1/conventions/extract", () => apiError(409, "repo_not_indexed", "not indexed"));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Run analysis" }));
    expect(await screen.findByText("This repo is not indexed yet")).toBeInTheDocument();
    // a blocked repo is a state, not an error banner
    expect(screen.queryByText("Could not start the scan")).not.toBeInTheDocument();
  });

  it("does not hide finished results just because the index is now degraded", async () => {
    server.indexStatus = "degraded";
    server.page = page({ candidates: [candidate("a")] });
    await renderView();
    expect(await screen.findByText("Rule number a for the team")).toBeInTheDocument();
    expect(screen.queryByText("This repo is not indexed yet")).not.toBeInTheDocument();
  });
});

describe("state 3: scanning", () => {
  const running = () => page({ running_scan: scan({ id: "s2", status: "running", finished_at: null }) });

  it("shows skeletons and a disabled Re-scan while a scan runs", async () => {
    server.page = running();
    await renderView();
    expect(await screen.findByText("Scanning the repo…")).toBeInTheDocument();
    expect(screen.getByText(/usually under a minute, up to ~2 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading conventions" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("header says Scanning… started X ago and hides the previous scan's stats (B5)", async () => {
    server.page = running();
    await renderView();
    expect(await screen.findByText(/^Scanning… started .+ ago$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Detected from/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Scan statistics" })).not.toBeInTheDocument();
  });

  it("disables Re-scan while the extract request itself is in flight", async () => {
    server.page = page({ candidates: [candidate("a")] });
    const extract = deferred();
    api.route("POST", "/repos/repo-1/conventions/extract", () => extract.promise);
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Re-scan" }));
    expect(await screen.findByRole("button", { name: "Scanning…" })).toBeDisabled();
    extract.resolve(json({ scan_id: "s9" }, 202));
  });
});

describe("state 4: failed", () => {
  it("shows the error and a Retry that re-runs the extract", async () => {
    server.page = page({ last_scan: scan({ status: "failed", error: "empty_sample" }), latest_done_scan: null });
    const user = await renderView();
    expect(await screen.findByText("The last scan failed")).toBeInTheDocument();
    expect(screen.getByText(/No readable code files were found/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.requestsTo("POST", "/repos/repo-1/conventions/extract")).toHaveLength(1));
  });

  it("maps a known error code to a human message and folds the raw text under Details (UX-1)", async () => {
    const raw = "scan_deadline_exceeded: scan ran past 120000ms";
    server.page = page({ last_scan: scan({ status: "failed", error: raw }), latest_done_scan: null });
    const user = await renderView();
    expect(await screen.findByText(/The scan took too long and was stopped/)).toBeInTheDocument();
    // Collapsed by default: the raw text is in the page but not shown until the person opens Details.
    expect(screen.getByText(raw)).not.toBeVisible();
    await user.click(screen.getByText("Details"));
    expect(screen.getByText(raw)).toBeVisible();
  });

  it("uses a generic message for an unknown code, keeping the raw text under Details", async () => {
    server.page = page({ last_scan: scan({ status: "failed", error: "weird_thing: x" }), latest_done_scan: null });
    await renderView();
    expect(await screen.findByText(/Something went wrong while scanning/)).toBeInTheDocument();
    expect(screen.getByText("weird_thing: x")).toBeInTheDocument();
  });

  it("header says the last scan failed and dates the older results it still shows (B5)", async () => {
    server.page = page({
      last_scan: scan({ id: "s3", status: "failed", error: "boom" }),
      latest_done_scan: scan({ id: "old", finished_at: "2026-09-20T09:00:42.000Z" }),
      candidates: [candidate("a", { status: "accepted" })],
    });
    await renderView();
    expect(await screen.findByText(/^Last scan failed .+ ago$/)).toBeInTheDocument();
    expect(screen.getByText(/^Showing results from scan of Sep 20, 2026$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Detected from/)).not.toBeInTheDocument();
  });

  it("keeps candidates from an earlier scan readable under the banner", async () => {
    server.page = page({
      last_scan: scan({ id: "s3", status: "failed", error: "boom" }),
      candidates: [candidate("a", { status: "accepted" })],
    });
    await renderView();
    expect(await screen.findByText("The last scan failed")).toBeInTheDocument();
    expect(screen.getByText("Rule number a for the team")).toBeInTheDocument();
  });
});

describe("state 5: done with zero verified", () => {
  it("reports how many candidates were dropped", async () => {
    server.page = page({ candidates: [], latest_done_scan: scan({ dropped_count: 4 }) });
    await renderView();
    expect(await screen.findByText("No conventions passed verification")).toBeInTheDocument();
    expect(screen.getByText("4 candidates were dropped because their evidence was not found in the repo.")).toBeInTheDocument();
  });
});

describe("state 6: every candidate rejected", () => {
  beforeEach(() => {
    server.page = page({ candidates: [candidate("r1", { status: "rejected" }), candidate("r2", { status: "rejected" })] });
  });

  it("points to the Rejected tab from the empty All tab", async () => {
    await renderView();
    expect(await screen.findByText("Every candidate is rejected")).toBeInTheDocument();
    expect(screen.getByText(/Open the Rejected tab/)).toBeInTheDocument();
    expect(screen.queryByText("Rule number r1 for the team")).not.toBeInTheDocument();
  });

  it("lists them on the Rejected tab", async () => {
    const user = await renderView();
    await user.click(await screen.findByRole("tab", { name: /^Rejected/ }));
    expect(screen.getByText("Rule number r1 for the team")).toBeInTheDocument();
    expect(screen.getByText("Rule number r2 for the team")).toBeInTheDocument();
  });
});

describe("load failure", () => {
  it("shows an error state with a retry that loads the page", async () => {
    api.route("GET", "/repos/repo-1/conventions", () => apiError(500, "internal", "boom"));
    const user = await renderView();
    expect(await screen.findByText("Could not load conventions.")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();

    api.route("GET", "/repos/repo-1/conventions", () => json(page({ candidates: [candidate("a")] })));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Rule number a for the team")).toBeInTheDocument();
    expect(screen.queryByText("Could not load conventions.")).not.toBeInTheDocument();
  });
});

describe("header and stats (AC-34)", () => {
  it("names the sample size and the scan's numbers", async () => {
    server.page = page({ candidates: [candidate("a")] });
    await renderView();
    expect(await screen.findByText(/Detected from 84 sample files · last scan/)).toBeInTheDocument();
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    for (const value of ["5", "3", "2", "1", "deepseek/deepseek-v4-flash", "12.3k in · 950 out", "~$0.0012", "42s"]) {
      expect(within(stats).getByText(value)).toBeInTheDocument();
    }
  });
});

describe("tabs and counts (D8)", () => {
  beforeEach(() => {
    server.page = page({
      candidates: [
        candidate("p", { status: "pending" }),
        candidate("a1", { status: "accepted" }),
        candidate("a2", { status: "accepted" }),
        candidate("r", { status: "rejected" }),
      ],
    });
  });

  it("counts All as pending plus accepted, and each other tab exactly", async () => {
    await renderView();
    expect(await screen.findByRole("tab", { name: "All, 3 items" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rejected, 1 item" })).toBeInTheDocument();
    expect(tab(/^All/)).toHaveTextContent("All3");
    expect(tab(/^Accepted/)).toHaveTextContent("Accepted2");
    expect(tab(/^Rejected/)).toHaveTextContent("Rejected1");
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
  });

  it("shows pending candidates only on All", async () => {
    const user = await renderView();
    expect(await screen.findByText("Rule number p for the team")).toBeInTheDocument();
    await user.click(tab(/^Accepted/));
    expect(screen.queryByText("Rule number p for the team")).not.toBeInTheDocument();
    expect(screen.getByText("Rule number a1 for the team")).toBeInTheDocument();
    await user.click(tab(/^Rejected/));
    expect(screen.getByText("Rule number r for the team")).toBeInTheDocument();
    expect(screen.queryByText("Rule number a1 for the team")).not.toBeInTheDocument();
  });

  it("offers selection checkboxes only on Accepted", async () => {
    const user = await renderView();
    await screen.findByText("Rule number p for the team");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    await user.click(tab(/^Accepted/));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("applies a decision at once and sends it as a PATCH", async () => {
    const user = await renderView();
    await screen.findByText("Rule number p for the team");
    await user.click(within(cardOf("Rule number p for the team")).getByRole("button", { name: "Accept" }));

    // Optimistic: the card and the tab counts move before the server has to answer.
    expect(within(cardOf("Rule number p for the team")).getByRole("button", { name: "Accepted" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(tab(/^Accepted/)).toHaveTextContent("Accepted3"));
    expect(api.requestsTo("PATCH", "/conventions/p").map((r) => r.body)).toEqual([{ status: "accepted" }]);
  });

  it("sends only the fields an edit changed", async () => {
    const user = await renderView();
    await screen.findByText("Rule number p for the team");
    const card = within(cardOf("Rule number p for the team"));
    await user.click(card.getByRole("button", { name: "Edit rule" }));
    await user.clear(card.getByRole("textbox", { name: "Rule" }));
    await user.paste("A brand new rule text");
    await user.click(card.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "A brand new rule text" })).toBeInTheDocument();
    expect(api.requestsTo("PATCH", "/conventions/p").map((r) => r.body)).toEqual([{ rule: "A brand new rule text" }]);
  });
});

describe("derived selection (AC-39, AC-42)", () => {
  const twoAccepted = () =>
    page({ candidates: [candidate("a1", { status: "accepted" }), candidate("a2", { status: "accepted" })] });
  const RULE_A1 = "Rule number a1 for the team";
  const RULE_A2 = "Rule number a2 for the team";

  async function openAccepted() {
    server.page = twoAccepted();
    const user = await renderView();
    await user.click(await screen.findByRole("tab", { name: /^Accepted/ }));
    return user;
  }

  it("keeps Create skill disabled until something accepted is selected", async () => {
    const user = await openAccepted();
    const create = screen.getByRole("button", { name: "Create skill" });
    expect(create).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: RULE_A1 }));
    expect(create).toBeEnabled();
    expect(screen.getByText("1 of 2 accepted selected")).toBeInTheDocument();
  });

  it("Select all and Deselect all act on the visible accepted cards", async () => {
    const user = await openAccepted();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2 of 2 accepted selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByText("0 of 2 accepted selected")).toBeInTheDocument();
  });

  it("drops a selected card from the selection the moment it stops being accepted", async () => {
    const user = await openAccepted();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2 of 2 accepted selected")).toBeInTheDocument();

    // a1 gets rejected: no stale id may remain in the selection.
    await user.click(within(cardOf(RULE_A1)).getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("1 of 1 accepted selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create skill" }));
    const body = (await screen.findByRole("textbox", { name: "Skill body" })) as HTMLTextAreaElement;
    expect(body.value).toContain(RULE_A2);
    expect(body.value).not.toContain(RULE_A1);
  });

  it("does not resurrect a selection after the card comes back accepted", async () => {
    const user = await openAccepted();
    await user.click(screen.getByRole("checkbox", { name: RULE_A1 }));
    await user.click(within(cardOf(RULE_A1)).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(tab(/^Rejected/)).toHaveTextContent("Rejected1"));

    // rejected -> pending -> accepted again
    await user.click(tab(/^Rejected/));
    await user.click(within(cardOf(RULE_A1)).getByRole("button", { name: "Rejected" }));
    await user.click(tab(/^All/));
    await user.click(within(cardOf(RULE_A1)).getByRole("button", { name: "Accept" }));
    await user.click(await screen.findByRole("tab", { name: /^Accepted/ }));

    // The stored id is still there, so a1 is selected again: that is the documented
    // intersection rule, and it is what the checkbox shows too.
    expect(screen.getByRole("checkbox", { name: RULE_A1 })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("1 of 2 accepted selected")).toBeInTheDocument();
  });

  it("opens the modal with the selection in list order and clears it after a create", async () => {
    const user = await openAccepted();
    await user.click(screen.getByRole("checkbox", { name: RULE_A2 }));
    await user.click(screen.getByRole("checkbox", { name: RULE_A1 }));
    await user.click(screen.getByRole("button", { name: "Create skill" }));

    const dialog = await screen.findByRole("dialog", { name: "Create skill from conventions" });
    const body = (within(dialog).getByRole("textbox", { name: "Skill body" }) as HTMLTextAreaElement).value;
    expect(body.indexOf(RULE_A1)).toBeGreaterThan(-1);
    expect(body.indexOf(RULE_A1)).toBeLessThan(body.indexOf(RULE_A2));

    await user.click(within(dialog).getByRole("button", { name: "Create skill" }));
    expect(await screen.findByText("Skill created")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 2 accepted selected")).toBeInTheDocument();
  });
});

describe("extract errors other than a blocked repo", () => {
  it("shows them inline, never as a toast", async () => {
    server.page = page({ candidates: [candidate("a")] });
    api.route("POST", "/repos/repo-1/conventions/extract", () => apiError(429, "rate_limited", "Too many requests"));
    const user = await renderView();
    await user.click(await screen.findByRole("button", { name: "Re-scan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not start the scan");
    expect(alert).toHaveTextContent("Too many requests");
  });
});

describe("unknown repo", () => {
  it("shows the shared no-repo state", async () => {
    api.route("GET", "/repos", () => json([]));
    renderWithProviders(
      <RepoProvider>
        <ConventionsView repoId="repo-1" />
      </RepoProvider>,
      { namespaces: NAMESPACES },
    );
    expect(await screen.findByText("No repo selected")).toBeInTheDocument();
  });
});
