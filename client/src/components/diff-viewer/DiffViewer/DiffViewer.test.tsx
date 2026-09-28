import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { PrFile, PrReviewComment } from "@/lib/types";
import diffViewerMessages from "../../../../messages/en/diffViewer.json";
import type { DiffCommentApi } from "../comments";
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
  return renderWithProviders(ui, { namespaces: { diffViewer: diffViewerMessages } });
}

describe("DiffViewer", () => {
  it("says so when there are no changed files", () => {
    renderViewer(<DiffViewer files={[]} />);
    expect(screen.getByText("No changed files.")).toBeInTheDocument();
  });

  it("toggles a file from its header button, which reports aria-expanded", () => {
    renderViewer(<DiffViewer files={[FILE]} />);
    const header = screen.getByRole("button", { name: /src\/config\.ts/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();

    fireEvent.click(header);

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
});
