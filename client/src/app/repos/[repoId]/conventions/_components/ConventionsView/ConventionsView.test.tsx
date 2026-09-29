/**
 * ConventionsView — the six page states (AC-32), the tabs and their counts
 * (D8), and the derived selection (AC-39). Data hooks, the shell and the
 * Create-skill modal are faked: the card, header and helpers run for real.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ConventionCandidate, ConventionsPage } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../messages/en/conventions.json";
import costMessages from "../../../../../../../messages/en/cost.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { candidate, page, scan } from "../../fixtures";

const h = vi.hoisted(() => ({
  query: {} as {
    data: ConventionsPage | undefined;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => void;
  },
  indexStatus: "full" as string | undefined,
  extractMutate: vi.fn(),
  extractPending: false,
  extractError: null as Error | null,
  extractReset: vi.fn(),
  clonePath: "/clones/x" as string | null,
  indexReason: undefined as string | undefined,
  resyncMutate: vi.fn(),
  resyncPending: false,
  resyncError: null as Error | null,
  pollArgs: [] as boolean[],
  updateMutate: vi.fn(),
  refetch: vi.fn(),
  repoNotFound: false,
  modalProps: null as null | {
    conventions: ConventionCandidate[];
    onCreated: () => void;
    onClose: () => void;
  },
}));

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>No repo selected</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo-1", name: "payments-api", full_name: "acme/payments-api", clone_path: h.clonePath },
  }),
  useRepoNotFound: () => h.repoNotFound,
}));
vi.mock("@/lib/hooks", () => ({
  useConventions: () => h.query,
  useRepoIntelStatus: (_id: string, poll?: boolean) => {
    h.pollArgs.push(!!poll);
    return {
      data: h.indexStatus ? { status: h.indexStatus, reason: h.indexReason } : undefined,
      isPending: false,
    };
  },
  useResyncRepoIntel: () => ({ mutate: h.resyncMutate, isPending: h.resyncPending, error: h.resyncError }),
  useExtractConventions: () => ({
    mutate: h.extractMutate,
    reset: h.extractReset,
    isPending: h.extractPending,
    error: h.extractError,
  }),
  useUpdateConvention: () => ({ mutate: h.updateMutate }),
}));
vi.mock("../TransformToSkillModal", () => ({
  TransformToSkillModal: (props: NonNullable<typeof h.modalProps>) => {
    h.modalProps = props;
    return <div role="dialog" aria-label="Create skill modal">{props.conventions.map((c) => c.id).join(",")}</div>;
  },
}));

import { ConventionsView } from "./ConventionsView";

function setPage(p: ConventionsPage | undefined, extra: Partial<typeof h.query> = {}) {
  h.query = { data: p, isPending: p === undefined, isError: false, error: null, refetch: h.refetch, ...extra };
}

function renderView() {
  return renderWithProviders(<ConventionsView repoId="repo-1" />, {
    namespaces: { conventions: messages, cost: costMessages, shell: shellMessages },
  });
}

beforeEach(() => {
  h.indexStatus = "full";
  h.extractMutate.mockReset();
  h.extractPending = false;
  h.extractError = null;
  h.extractReset.mockReset();
  h.clonePath = "/clones/x";
  h.indexReason = undefined;
  h.resyncMutate.mockReset();
  h.resyncPending = false;
  h.resyncError = null;
  h.pollArgs = [];
  h.updateMutate.mockReset();
  h.refetch.mockReset();
  h.repoNotFound = false;
  h.modalProps = null;
  setPage(page());
});
afterEach(cleanup);

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("state 1: never scanned", () => {
  it("offers Run analysis, which starts the extract", () => {
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByText("No analysis yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    expect(h.extractMutate).toHaveBeenCalledTimes(1);
  });
});

describe("state 2: repo not indexed", () => {
  it("offers Index repository and holds Re-scan when the index is not usable", () => {
    h.indexStatus = "failed";
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByText("This repo is not indexed yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index repository" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeDisabled();
  });

  it("resyncs on click, then polls the index state and moves to never-scanned once indexed", () => {
    h.indexStatus = "failed";
    h.resyncMutate.mockImplementation((_v: undefined, o: { onSuccess: () => void }) => o.onSuccess());
    setPage(page({ last_scan: null, latest_done_scan: null }));
    const { rerender } = renderView();
    expect(h.pollArgs.at(-1)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Index repository" }));
    expect(h.resyncMutate).toHaveBeenCalledTimes(1);
    expect(h.pollArgs.at(-1)).toBe(true);
    // still not usable: the CTA stays in its pending state
    expect(screen.getByRole("button", { name: "Indexing…" })).toBeDisabled();

    h.indexStatus = "full";
    rerender(<ConventionsView repoId="repo-1" />);
    expect(h.pollArgs.at(-1)).toBe(false);
    expect(h.extractReset).toHaveBeenCalled();
    expect(screen.getByText("No analysis yet")).toBeInTheDocument();
  });

  it("disables the CTA while the resync request is in flight", () => {
    h.indexStatus = "failed";
    h.resyncPending = true;
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByRole("button", { name: "Indexing…" })).toBeDisabled();
  });

  it("shows the API message inline when the resync fails", () => {
    h.indexStatus = "failed";
    h.resyncError = new ApiError("Clone is locked", 409, "clone_locked");
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not start indexing. Clone is locked");
    expect(screen.getByRole("button", { name: "Index repository" })).toBeEnabled();
  });

  it("says to re-import, with no button, when the repo has no clone", () => {
    h.clonePath = null;
    h.indexStatus = "failed";
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByText("Repository is not cloned yet — re-import it from Pull Requests")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Index repository" })).not.toBeInTheDocument();
  });

  it("treats a 409 repo_not_cloned from the extract as not cloned", () => {
    h.extractError = new ApiError("not cloned", 409, "repo_not_cloned");
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByText(/re-import it from Pull Requests/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Index repository" })).not.toBeInTheDocument();
  });

  it("also shows it when the extract answers 409 repo_not_indexed", () => {
    h.extractError = new ApiError("not indexed", 409, "repo_not_indexed");
    setPage(page({ last_scan: null, latest_done_scan: null }));
    renderView();
    expect(screen.getByText("This repo is not indexed yet")).toBeInTheDocument();
    // a blocked repo is a state, not an error banner
    expect(screen.queryByText("Could not start the scan")).not.toBeInTheDocument();
  });

  it("does not hide finished results just because the index is now degraded", () => {
    h.indexStatus = "degraded";
    setPage(page({ candidates: [candidate("a")] }));
    renderView();
    expect(screen.queryByText("This repo is not indexed yet")).not.toBeInTheDocument();
    expect(screen.getByText("Rule number a for the team")).toBeInTheDocument();
  });
});

describe("state 3: scanning", () => {
  it("shows skeletons and a disabled Re-scan while a scan runs", () => {
    setPage(page({ running_scan: scan({ id: "s2", status: "running", finished_at: null }) }));
    renderView();
    expect(screen.getByText("Scanning the repo…")).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("disables Re-scan while the extract request itself is in flight", () => {
    h.extractPending = true;
    renderView();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });
});

describe("state 4: failed", () => {
  it("shows the error and a Retry that re-runs the extract", () => {
    setPage(page({ last_scan: scan({ status: "failed", error: "empty_sample" }), latest_done_scan: null }));
    renderView();
    expect(screen.getByText("The last scan failed")).toBeInTheDocument();
    expect(screen.getByText("empty_sample")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.extractMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps candidates from an earlier scan readable under the banner", () => {
    setPage(page({ last_scan: scan({ id: "s3", status: "failed", error: "boom" }), candidates: [candidate("a", { status: "accepted" })] }));
    renderView();
    expect(screen.getByText("The last scan failed")).toBeInTheDocument();
    expect(screen.getByText("Rule number a for the team")).toBeInTheDocument();
  });
});

describe("state 5: done with zero verified", () => {
  it("reports how many candidates were dropped", () => {
    setPage(page({ candidates: [], latest_done_scan: scan({ dropped_count: 4 }) }));
    renderView();
    expect(screen.getByText("No conventions passed verification")).toBeInTheDocument();
    expect(screen.getByText("4 candidates were dropped because their evidence was not found in the repo.")).toBeInTheDocument();
  });
});

describe("state 6: every candidate rejected", () => {
  beforeEach(() => {
    setPage(page({ candidates: [candidate("r1", { status: "rejected" }), candidate("r2", { status: "rejected" })] }));
  });

  it("points to the Rejected tab from the empty All tab", () => {
    renderView();
    expect(screen.getByText("Every candidate is rejected")).toBeInTheDocument();
    expect(screen.getByText(/Open the Rejected tab/)).toBeInTheDocument();
    expect(screen.queryByText("Rule number r1 for the team")).not.toBeInTheDocument();
  });

  it("lists them on the Rejected tab", () => {
    renderView();
    fireEvent.click(tab(/^Rejected/));
    expect(screen.getByText("Rule number r1 for the team")).toBeInTheDocument();
    expect(screen.getByText("Rule number r2 for the team")).toBeInTheDocument();
  });
});

describe("load failure", () => {
  it("shows an error state with a retry", () => {
    setPage(undefined, { isPending: false, isError: true, error: new Error("boom") });
    renderView();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("header and stats (AC-34)", () => {
  it("names the sample size and the scan's numbers", () => {
    setPage(page({ candidates: [candidate("a")] }));
    renderView();
    expect(screen.getByText(/Detected from 84 sample files · last scan/)).toBeInTheDocument();
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    for (const value of ["5", "3", "2", "1", "deepseek/deepseek-v4-flash", "12.3k in · 950 out", "~$0.0012", "42s"]) {
      expect(within(stats).getByText(value)).toBeInTheDocument();
    }
  });
});

describe("tabs and counts (D8)", () => {
  beforeEach(() => {
    setPage(
      page({
        candidates: [
          candidate("p", { status: "pending" }),
          candidate("a1", { status: "accepted" }),
          candidate("a2", { status: "accepted" }),
          candidate("r", { status: "rejected" }),
        ],
      }),
    );
  });

  it("counts All as pending plus accepted, and each other tab exactly", () => {
    renderView();
    expect(tab(/^All/)).toHaveTextContent("All3");
    expect(screen.getByRole("tab", { name: "All, 3 items" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rejected, 1 item" })).toBeInTheDocument();
    expect(tab(/^Accepted/)).toHaveTextContent("Accepted2");
    expect(tab(/^Rejected/)).toHaveTextContent("Rejected1");
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
  });

  it("shows pending candidates only on All", () => {
    renderView();
    expect(screen.getByText("Rule number p for the team")).toBeInTheDocument();
    fireEvent.click(tab(/^Accepted/));
    expect(screen.queryByText("Rule number p for the team")).not.toBeInTheDocument();
    expect(screen.getByText("Rule number a1 for the team")).toBeInTheDocument();
    fireEvent.click(tab(/^Rejected/));
    expect(screen.getByText("Rule number r for the team")).toBeInTheDocument();
    expect(screen.queryByText("Rule number a1 for the team")).not.toBeInTheDocument();
  });

  it("offers selection checkboxes only on Accepted", () => {
    renderView();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(tab(/^Accepted/));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("sends a decision as an optimistic PATCH", () => {
    renderView();
    fireEvent.click(within(screen.getByText("Rule number p for the team").closest("article")!).getByRole("button", { name: "Accept" }));
    expect(h.updateMutate).toHaveBeenCalledWith({ id: "p", patch: { status: "accepted" } });
  });

  it("sends only the fields an edit changed", () => {
    renderView();
    const card = screen.getByText("Rule number p for the team").closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Edit rule" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Rule" }), { target: { value: "A brand new rule text" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    expect(h.updateMutate).toHaveBeenCalledWith({ id: "p", patch: { rule: "A brand new rule text" } });
  });
});

describe("derived selection (AC-39, AC-42)", () => {
  const twoAccepted = () =>
    page({ candidates: [candidate("a1", { status: "accepted" }), candidate("a2", { status: "accepted" })] });

  it("keeps Create skill disabled until something accepted is selected", () => {
    setPage(twoAccepted());
    renderView();
    fireEvent.click(tab(/^Accepted/));
    const create = screen.getByRole("button", { name: "Create skill" });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Rule number a1 for the team" }));
    expect(create).toBeEnabled();
    expect(screen.getByText("1 of 2 accepted selected")).toBeInTheDocument();
  });

  it("Select all and Deselect all act on the visible accepted cards", () => {
    setPage(twoAccepted());
    renderView();
    fireEvent.click(tab(/^Accepted/));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2 of 2 accepted selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByText("0 of 2 accepted selected")).toBeInTheDocument();
  });

  it("drops a selected card from the selection the moment it stops being accepted", () => {
    setPage(twoAccepted());
    const { rerender } = renderView();
    fireEvent.click(tab(/^Accepted/));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("2 of 2 accepted selected")).toBeInTheDocument();

    // a1 gets rejected (an optimistic update, or a rescan): no stale id may remain.
    setPage(page({ candidates: [candidate("a1", { status: "rejected" }), candidate("a2", { status: "accepted" })] }));
    rerender(<ConventionsView repoId="repo-1" />);
    expect(screen.getByText("1 of 1 accepted selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(h.modalProps?.conventions.map((c) => c.id)).toEqual(["a2"]);
  });

  it("does not resurrect a selection after the card comes back accepted", () => {
    setPage(twoAccepted());
    const { rerender } = renderView();
    fireEvent.click(tab(/^Accepted/));
    fireEvent.click(screen.getByRole("checkbox", { name: "Rule number a1 for the team" }));
    setPage(page({ candidates: [candidate("a1", { status: "rejected" }), candidate("a2", { status: "accepted" })] }));
    rerender(<ConventionsView repoId="repo-1" />);
    setPage(twoAccepted());
    rerender(<ConventionsView repoId="repo-1" />);
    // The stored id is still there, so a1 is selected again: that is the documented
    // intersection rule, and it is what the checkbox shows too.
    expect(screen.getByRole("checkbox", { name: "Rule number a1 for the team" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("1 of 2 accepted selected")).toBeInTheDocument();
  });

  it("opens the modal with the selection in list order and clears it after a create", () => {
    setPage(twoAccepted());
    renderView();
    fireEvent.click(tab(/^Accepted/));
    fireEvent.click(screen.getByRole("checkbox", { name: "Rule number a2 for the team" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Rule number a1 for the team" }));
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(screen.getByRole("dialog", { name: "Create skill modal" })).toHaveTextContent("a1,a2");

    act(() => h.modalProps?.onCreated());
    act(() => h.modalProps?.onClose());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 2 accepted selected")).toBeInTheDocument();
  });
});

describe("extract errors other than a blocked repo", () => {
  it("shows them inline, never as a toast", () => {
    h.extractError = new ApiError("Too many requests", 429, "rate_limited");
    setPage(page({ candidates: [candidate("a")] }));
    renderView();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not start the scan");
    expect(alert).toHaveTextContent("Too many requests");
  });
});

describe("unknown repo", () => {
  it("shows the shared no-repo state", () => {
    h.repoNotFound = true;
    renderView();
    expect(screen.getByText("No repo selected")).toBeInTheDocument();
  });
});
