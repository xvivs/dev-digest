import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { PrReviewComment } from "@/lib/types";
import diffViewerMessages from "../../../../messages/en/diffViewer.json";
import { CommentCard } from "./CommentCard";

function comment(over: Partial<PrReviewComment>): PrReviewComment {
  return {
    id: 1,
    path: "src/config.ts",
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

function renderCard(c: PrReviewComment) {
  return renderWithProviders(<CommentCard c={c} />, { namespaces: { diffViewer: diffViewerMessages } });
}

describe("CommentCard markdown hardening", () => {
  it("renders a GitHub comment body in safe mode: no auto-loading image, link shows the URL", () => {
    renderCard(comment({ body: "![x](https://evil.test/p.png) nice catch" }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const imgLink = screen.getByRole("link", { name: /x \(https:\/\/evil\.test\/p\.png\)/ });
    expect(imgLink).toHaveAttribute("target", "_blank");
    expect(imgLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens a normal link in a new tab with rel=noopener noreferrer", () => {
    renderCard(comment({ body: "see [the docs](https://example.test/fix)" }));

    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.test/fix");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
