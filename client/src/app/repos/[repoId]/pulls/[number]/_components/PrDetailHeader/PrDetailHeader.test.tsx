import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const TITLE = `#482 ${PR.title}`;
const CONDENSED_TABS = { name: "PR sections (condensed)" };
// The bar is `inert` + aria-hidden while hidden, so it is only in the a11y tree
// (and only reachable by role) when shown. `hidden: true` reaches it either way.
const barTitle = () => screen.getByRole("button", { name: TITLE, hidden: true });
const barShown = () => screen.queryByRole("tablist", CONDENSED_TABS) !== null;
const barInert = () => barTitle().closest("[inert]") !== null;

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

// jsdom has no Element.scrollTo; install a spy and restore the prior state so it cannot leak.
const scrollTo = vi.fn();
let hadScrollTo = false;
beforeEach(() => {
  scrollTo.mockClear();
  hadScrollTo = "scrollTo" in Element.prototype;
  Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: scrollTo });
});
afterEach(() => {
  if (!hadScrollTo) delete (Element.prototype as Partial<Element>).scrollTo;
});

describe("PrDetailHeader", () => {
  it("desktop: full header with text labels, no bar, one tablist", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "View on GitHub" })).toHaveTextContent("View on GitHub");
    expect(screen.getByRole("button", { name: /Run Review/ })).toHaveTextContent("Run Review");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`#482${PR.title}`);
    expect(screen.queryByRole("tablist", { ...CONDENSED_TABS, hidden: true })).toBeNull();
    expect(screen.queryByRole("button", { name: TITLE, hidden: true })).toBeNull();
    expect(screen.getAllByRole("tablist", { hidden: true })).toHaveLength(1);
  });

  it("mobile: icon-sized actions keep their accessible name and title", () => {
    renderHeader({ mobile: true });
    const github = screen.getAllByRole("button", { name: "View on GitHub" })[0]!;
    expect(github).toHaveAttribute("title", "View on GitHub");
    const run = screen.getAllByRole("button", { name: "Run Review" })[0]!;
    expect(run).toHaveAttribute("title", "Run Review");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("mobile, not yet scrolled: the bar is inert and out of the a11y tree; nothing in it is reachable", () => {
    renderHeader({ mobile: true });
    expect(barShown()).toBe(false);
    expect(barTitle().closest("[aria-hidden=true]")).not.toBeNull();
    expect(barInert()).toBe(true);
    expect(screen.queryByRole("button", { name: TITLE })).toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("observer callback shows the bar and, on return, hides it again; tablists get distinct names", () => {
    renderHeader({ mobile: true });
    scrollPast(true);
    expect(barShown()).toBe(true);
    expect(barInert()).toBe(false);
    const title = screen.getByRole("button", { name: TITLE });
    expect(title).toHaveAttribute("title", PR.title);
    expect(barTitle().closest("[aria-hidden=true]")).toBeNull();
    // header + bar each carry a Run Review trigger
    expect(screen.getAllByRole("button", { name: "Run Review" })).toHaveLength(2);
    expect(screen.getByRole("tablist", { name: "PR sections" })).toBeInTheDocument();
    scrollPast(false);
    expect(barShown()).toBe(false);
    expect(barInert()).toBe(true);
  });

  it("the bar's tabs drive the same handler", async () => {
    const user = userEvent.setup();
    const onSetTab = vi.fn();
    renderHeader({ mobile: true, onSetTab });
    scrollPast(true);
    await user.click(within(screen.getByRole("tablist", CONDENSED_TABS)).getByRole("tab", { name: /Files changed/ }));
    expect(onSetTab).toHaveBeenCalledWith("diff");
  });

  it("bar title scrolls <main> to top: smooth, or instant under reduced motion", async () => {
    const user = userEvent.setup();
    renderHeader({ mobile: true });
    scrollPast(true);
    await user.click(screen.getByRole("button", { name: TITLE }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    cleanup();

    reduced = true;
    renderHeader({ mobile: true });
    scrollPast(true);
    await user.click(screen.getByRole("button", { name: TITLE }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
  });

  it("moves focus from the bar to the heading before the bar hides; does not touch focus otherwise", () => {
    renderHeader({ mobile: true });
    expect(document.body).toHaveFocus(); // nothing focused on mount
    scrollPast(true);
    expect(document.body).toHaveFocus(); // and none stolen when the bar appears
    act(() => screen.getByRole("button", { name: TITLE }).focus());
    scrollPast(false);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveFocus();
    expect(h1).toHaveAttribute("tabindex", "-1");
    // `preventScroll: true` is not observable in jsdom; the no-jump behaviour is browser-verified.
  });
});
