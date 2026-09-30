import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import type { PrDetail } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/reviews", () => ({ useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

import { PrDetailHeader, type PrDetailHeaderProps } from "./PrDetailHeader";

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
  body: "",
  files: [],
  commits: [],
} as unknown as PrDetail;

afterEach(cleanup);

const baseProps: PrDetailHeaderProps = {
  pr: PR,
  prId: "pr-uuid",
  tab: "overview",
  findingsCount: 0,
  githubUrl: "https://github.com/acme/x/pull/482",
  onSetTab: vi.fn(),
  onRunStart: vi.fn(),
};

// <main> is the scroll container the compact title scrolls.
function renderHeader(props: Partial<PrDetailHeaderProps> = {}) {
  return renderWithProviders(
    <main>
      <PrDetailHeader {...baseProps} {...props} />
    </main>,
    { namespaces: { prReview } },
  );
}

describe("PrDetailHeader", () => {
  it("desktop: text buttons, meta visible, plain title, no compact state", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "View on GitHub" })).toHaveTextContent("View on GitHub");
    expect(screen.getByRole("button", { name: /Run Review/ })).toHaveTextContent("Run Review");
    expect(screen.getByText("dana")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`#482${PR.title}`);
    expect(document.querySelector("[data-compact]")).toHaveAttribute("data-compact", "false");
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("desktop ignores `compact` (it never collapses)", () => {
    renderHeader({ compact: true });
    expect(screen.queryByTitle(PR.title)).toBeNull();
    expect(document.querySelector("[data-compact]")).toHaveAttribute("data-compact", "false");
  });

  it("mobile: actions are icon-only with an accessible name and title", () => {
    renderHeader({ mobile: true });
    const github = screen.getByRole("button", { name: "View on GitHub" });
    expect(github).toHaveAttribute("title", "View on GitHub");
    expect(github).toHaveTextContent("");
    const run = screen.getByRole("button", { name: "Run Review" });
    expect(run).toHaveAttribute("title", "Run Review");
    expect(run).toHaveTextContent("");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("mobile expanded: meta is reachable (not inert)", () => {
    renderHeader({ mobile: true });
    expect(screen.getByText("dana").closest("[inert]")).toBeNull();
  });

  it("mobile compact: meta and GitHub action leave the tab order, the title is one button with the full name", () => {
    renderHeader({ mobile: true, compact: true });
    expect(screen.getByText("dana").closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "View on GitHub", hidden: true }).closest("[hidden]")).not.toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    const title = screen.getByRole("button", { name: `#482 ${PR.title}` });
    expect(h1).toContainElement(title);
    expect(title).toHaveAttribute("title", PR.title);
    // Primary action and tabs stay.
    expect(screen.getByRole("button", { name: "Run Review" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("compact title scrolls <main> to top, smooth by default and instant under reduced motion", () => {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const name = `#482 ${PR.title}`;
    renderHeader({ mobile: true, compact: true });
    fireEvent.click(screen.getByRole("button", { name }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    cleanup();

    renderHeader({ mobile: true, compact: true, reducedMotion: true });
    fireEvent.click(screen.getByRole("button", { name }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    delete (Element.prototype as Partial<Element>).scrollTo;
  });

  it("moves focus to the compact title when it collapses around the focused GitHub button", () => {
    function Host() {
      const [compact, setCompact] = React.useState(false);
      return (
        <main>
          <button onClick={() => setCompact(true)}>collapse</button>
          <PrDetailHeader {...baseProps} mobile compact={compact} />
        </main>
      );
    }
    renderWithProviders(<Host />, { namespaces: { prReview } });
    screen.getByRole("button", { name: "View on GitHub" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    expect(screen.getByRole("button", { name: `#482 ${PR.title}` })).toHaveFocus();
  });
});
