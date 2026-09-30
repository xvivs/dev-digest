import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import type { PrDetail } from "@/lib/types";

let reduced = false;
vi.mock("@devdigest/ui", async (orig) => ({
  ...(await orig<typeof import("@devdigest/ui")>()),
  usePrefersReducedMotion: () => reduced,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePrActiveRuns: () => ({ data: [] }),
}));

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

afterEach(() => {
  cleanup();
  reduced = false;
});

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

const bar = () => screen.getByTestId("condensed-bar");

// jsdom has no IntersectionObserver: a fake the tests drive by hand.
let observerCallback: ((e: Partial<IntersectionObserverEntry>[]) => void) | null = null;
class FakeIO {
  constructor(cb: (e: Partial<IntersectionObserverEntry>[]) => void) {
    observerCallback = cb;
  }
  observe() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("IntersectionObserver", FakeIO));
afterEach(() => {
  vi.unstubAllGlobals();
  observerCallback = null;
});
/** The header's bottom edge leaves through the top of <main> (or comes back). */
const scrollPast = (past: boolean) =>
  act(() =>
    observerCallback?.([
      { isIntersecting: !past, boundingClientRect: { top: past ? -5 : 10 } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly },
    ]),
  );

describe("PrDetailHeader", () => {
  it("desktop: sticky full header, text labels, no bar, no sentinel", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "View on GitHub" })).toHaveTextContent("View on GitHub");
    expect(screen.getByRole("button", { name: /Run Review/ })).toHaveTextContent("Run Review");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`#482${PR.title}`);
    expect(screen.queryByTestId("condensed-bar")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).parentElement!.parentElement!.parentElement).toHaveStyle({ position: "sticky" });
    expect(document.querySelector("[inert]")).toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("mobile: full header scrolls (not sticky), actions carry aria-label + title, labels use the hide utility", () => {
    renderHeader({ mobile: true });
    expect(screen.getByRole("heading", { level: 1 }).parentElement!.parentElement!.parentElement).toHaveStyle({ position: "static" });
    const github = screen.getAllByRole("button", { name: "View on GitHub" })[0]!;
    expect(github).toHaveAttribute("title", "View on GitHub");
    expect(github.querySelector(".dd-hide-below-md")).toHaveTextContent("View on GitHub");
    const run = screen.getAllByRole("button", { name: "Run Review" })[0]!;
    expect(run).toHaveAttribute("title", "Run Review");
    expect(run.querySelector(".dd-hide-below-md")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("mobile, not yet scrolled: the bar is inert, aria-hidden and off-screen; nothing in it is reachable", () => {
    renderHeader({ mobile: true });
    expect(bar()).toHaveAttribute("inert");
    expect(bar()).toHaveAttribute("aria-hidden", "true");
    expect(bar().style.transform).toBe("translateY(-100%)");
    expect(screen.queryByRole("button", { name: `#482 ${PR.title}` })).toBeNull(); // hidden from the a11y tree
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("observer callback shows the bar and, on return, hides it again; tablists get distinct names", () => {
    renderHeader({ mobile: true });
    scrollPast(true);
    expect(bar()).not.toHaveAttribute("inert");
    expect(bar()).not.toHaveAttribute("aria-hidden", "true");
    expect(bar().style.transform).toBe("translateY(0)");
    const title = within(bar()).getByRole("button", { name: `#482 ${PR.title}` });
    expect(title).toHaveAttribute("title", PR.title);
    expect(within(bar()).getByRole("button", { name: "Run Review" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "PR sections" })).toBeInTheDocument();
    expect(within(bar()).getByRole("tablist", { name: "PR sections (condensed)" })).toBeInTheDocument();
    scrollPast(false);
    expect(bar()).toHaveAttribute("inert");
  });

  it("the bar's tabs drive the same handler", () => {
    const onSetTab = vi.fn();
    renderHeader({ mobile: true, onSetTab });
    scrollPast(true);
    fireEvent.click(within(bar()).getByRole("tab", { name: /Files changed/ }));
    expect(onSetTab).toHaveBeenCalledWith("diff");
  });

  it("bar title scrolls <main> to top: smooth, or instant under reduced motion", () => {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const name = `#482 ${PR.title}`;
    renderHeader({ mobile: true });
    scrollPast(true);
    fireEvent.click(within(bar()).getByRole("button", { name }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    expect(bar().style.transition).not.toBe("none");
    cleanup();

    reduced = true;
    renderHeader({ mobile: true });
    scrollPast(true);
    fireEvent.click(within(bar()).getByRole("button", { name }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    expect(bar().style.transition).toBe("none");
    delete (Element.prototype as Partial<Element>).scrollTo;
  });

  it("moves focus from the bar to the heading (no scroll) before the bar hides; does not touch focus otherwise", () => {
    renderHeader({ mobile: true });
    expect(document.body).toHaveFocus(); // nothing focused on mount
    scrollPast(true);
    expect(document.body).toHaveFocus(); // and none stolen when the bar appears
    const title = within(bar()).getByRole("button", { name: `#482 ${PR.title}` });
    title.focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    scrollPast(false);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveFocus();
    expect(h1).toHaveAttribute("tabindex", "-1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });
});
