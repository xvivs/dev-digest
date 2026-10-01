import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FindingRecord } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import type { PrFile, PrReviewComment } from "@/lib/types";
import diffViewerMessages from "../../../../messages/en/diffViewer.json";
import type { DiffCommentApi } from "../comments";
import type { DiffFindingApi } from "../findings";
// The real card DiffTab plugs in (it only needs the prReview messages).
import { DiffFindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/DiffFindingCard";
import prReviewMessages from "../../../../messages/en/prReview.json";
import { DiffViewer } from "./DiffViewer";

const FILE: PrFile = {
  path: "src/config.ts",
  additions: 2,
  deletions: 1,
  patch: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
};

function comment(over: Partial<PrReviewComment>): PrReviewComment {
  return {
    id: 1,
    path: FILE.path,
    line: 3,
    original_line: 3,
    side: "RIGHT",
    body: "looks good",
    user: "octocat",
    created_at: "2026-09-01T10:00:00Z",
    html_url: "https://github.com/acme/api/pull/1#discussion_r1",
    in_reply_to_id: null,
    is_outdated: false,
    ...over,
  };
}

function commenting(comments: PrReviewComment[]): DiffCommentApi {
  return { comments, canComment: false, showComments: true, posting: false, onSubmit: async () => undefined };
}

function renderViewer(ui: React.ReactElement) {
  return renderWithProviders(ui, { namespaces: { diffViewer: diffViewerMessages, prReview: prReviewMessages } });
}

describe("DiffViewer", () => {
  it("says so when there are no changed files", () => {
    renderViewer(<DiffViewer files={[]} />);
    expect(screen.getByText("No changed files.")).toBeInTheDocument();
  });

  it("toggles a file from its header button, which reports aria-expanded", async () => {
    const user = userEvent.setup();
    renderViewer(<DiffViewer files={[FILE]} />);
    const header = screen.getByRole("button", { name: /src\/config\.ts/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();
  });

  it("explains an empty patch (binary file) instead of rendering nothing", () => {
    renderViewer(<DiffViewer files={[{ ...FILE, patch: null }]} />);
    expect(screen.getByText(/No diff text available/)).toBeInTheDocument();
  });

  it("links an anchored comment to GitHub, and lists unanchored ones as outdated", () => {
    renderViewer(
      <DiffViewer
        files={[FILE]}
        commenting={commenting([comment({ id: 1 }), comment({ id: 2, line: null, body: "stale note" })])}
      />,
    );
    expect(screen.getByText("looks good")).toBeInTheDocument();
    expect(screen.getByText("1 comment on older revisions")).toBeInTheDocument();
    expect(screen.getByText("stale note")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View on GitHub" })[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/api/pull/1#discussion_r1",
    );
  });

  it("drops the GitHub link when html_url is not http(s)", () => {
    renderViewer(
      <DiffViewer files={[FILE]} commenting={commenting([comment({ html_url: "javascript:alert(1)" })])} />,
    );
    expect(screen.getByText("looks good")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View on GitHub" })).not.toBeInTheDocument();
  });

  describe("with agent findings", () => {
    function finding(over: Partial<FindingRecord>): FindingRecord {
      return {
        id: "f1",
        severity: "CRITICAL",
        category: "bug",
        title: "Boundary untested",
        file: FILE.path,
        start_line: 3,
        end_line: 3,
        rationale: "r",
        suggestion: null,
        confidence: 0.9,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        review_id: "rv",
        accepted_at: null,
        dismissed_at: null,
        ...over,
      } as FindingRecord;
    }

    function api(findings: FindingRecord[], over: Partial<DiffFindingApi> = {}): DiffFindingApi {
      return { findings, show: true, Card: DiffFindingCard, onAction: vi.fn(), pendingId: null, ...over };
    }

    it("renders the card right after the row of its start line, with a severity label", () => {
      // Anchored on the MIDDLE line so "right after" is pinned on both sides.
      renderViewer(<DiffViewer files={[FILE]} findings={api([finding({ start_line: 2, end_line: 2 })])} />);
      const card = screen.getByText("Boundary untested");
      const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(screen.getByText("const b = 3;"), card)).toBe(true);
      expect(after(card, screen.getByText("const c = 4;"))).toBe(true);
      expect(after(screen.getByText("const b = 3;"), screen.getByText("blocker"))).toBe(true);
      expect(after(screen.getByText("blocker"), screen.getByText("const c = 4;"))).toBe(true);
    });

    it("marks the file header with a finding dot next to the unchanged comment counter", () => {
      renderViewer(
        <DiffViewer
          files={[FILE]}
          commenting={commenting([comment({ id: 1 })])}
          findings={api([finding({})])}
        />,
      );
      expect(screen.getByRole("img", { name: "1 finding" })).toBeInTheDocument();
      expect(screen.getByTitle("1 comment")).toBeInTheDocument();
    });

    it("puts a finding on a line that is not rendered into the end-of-file block", () => {
      renderViewer(<DiffViewer files={[FILE]} findings={api([finding({ start_line: 99, end_line: 99 })])} />);
      expect(screen.getByText("1 finding outside the shown lines")).toBeInTheDocument();
      expect(screen.getByText("Boundary untested")).toBeInTheDocument();
    });

    it("still shows the block when the file has no patch", () => {
      renderViewer(<DiffViewer files={[{ ...FILE, patch: null }]} findings={api([finding({})])} />);
      expect(screen.getByText(/No diff text available/)).toBeInTheDocument();
      expect(screen.getByText("1 finding outside the shown lines")).toBeInTheDocument();
    });

    it("hides cards when show is false but keeps the dot and the label", () => {
      renderViewer(<DiffViewer files={[FILE]} findings={api([finding({})], { show: false })} />);
      expect(screen.queryByText("Boundary untested")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "1 finding" })).toBeInTheDocument();
      expect(screen.getByText("blocker")).toBeInTheDocument();
    });

    it("collapses a file when defaultOpenFor returns false", () => {
      renderViewer(<DiffViewer files={[FILE]} findings={api([finding({})])} defaultOpenFor={() => false} />);
      expect(screen.getByRole("button", { name: /src\/config\.ts/ })).toHaveAttribute("aria-expanded", "false");
    });

    it("reports Accept with the finding", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      const f = finding({});
      renderViewer(<DiffViewer files={[FILE]} findings={api([f], { onAction })} />);
      await user.click(screen.getByRole("button", { name: "Accept" }));
      expect(onAction).toHaveBeenCalledWith(f, "accept");
    });
  });
});
