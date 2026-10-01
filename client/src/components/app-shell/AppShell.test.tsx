/**
 * AppShell logo trigger + nav drawer. Real shell hooks, real AppFrame, real
 * Drawer; only the router boundary (next/navigation) is stubbed. The repo and
 * theme contexts fall back to their defaults without a provider.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import shellMessages from "../../../messages/en/shell.json";
import { DRAWER_FADE_MS, DRAWER_REVEAL_MS } from "@devdigest/ui";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => mockReducedMotion(false));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // @ts-expect-error restore jsdom's lack of matchMedia
  delete window.matchMedia;
});

function renderShell() {
  renderWithProviders(<AppShell>content</AppShell>, { namespaces: { shell: shellMessages } });
}
const trigger = () => screen.getByRole("button", { name: /^(Open|Close) navigation$/ });
const dialog = () => screen.getByRole("dialog", { name: "Navigation" });
const backdrop = () => screen.getByTestId("drawer-backdrop");

describe("AppShell logo trigger: focus return on every close path", () => {
  // Focus is restored on the next frame, after the Drawer's own cleanup, so wait for it.
  const closePaths: Array<[string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]> = [
    ["Escape", (user) => user.keyboard("{Escape}")],
    ["the close button", (user) => user.click(within(dialog()).getByRole("button", { name: "Close" }))],
    ["a backdrop tap", (user) => user.click(backdrop())],
    ["the logo again", (user) => user.click(trigger())],
    ["the Home link", (user) => user.click(within(dialog()).getByRole("link", { name: "Home" }))],
  ];

  it.each(closePaths)("%s closes the drawer and returns focus to the logo", async (_name, close) => {
    const user = userEvent.setup();
    renderShell();
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).not.toHaveFocus(); // focus moved into the dialog
    await close(user);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(trigger()).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("returns focus to the logo even when the opening click never focused it (Safari)", async () => {
    const user = userEvent.setup();
    renderShell();
    // A native .click() does not focus the button, unlike a userEvent click.
    act(() => trigger().click());
    expect(trigger()).not.toHaveFocus();
    expect(document.body).not.toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("does not take focus on initial mount", () => {
    renderShell();
    expect(trigger()).not.toHaveFocus();
  });
});

describe("AppShell logo trigger: open / close lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // RTL's asyncWrapper only flushes fake timers when it sees a `jest` global.
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });
  const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const settle = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("renders the trigger and the desktop sidebar logo; no dialog until opened", () => {
    renderShell();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("DevDigest")).toHaveLength(2); // trigger + desktop sidebar
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a dialog named exactly 'Navigation' with no second logo, wired to the trigger", async () => {
    const user = setup();
    renderShell();
    await user.click(trigger());
    expect(within(dialog()).queryByText("DevDigest")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAccessibleName("Close navigation");
    expect(trigger().getAttribute("aria-controls")).toBe(dialog().id);
    expect(within(dialog()).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("reveals from the logo mark's centre", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 12, top: 15, width: 22, height: 22, right: 34, bottom: 37, x: 12, y: 15, toJSON: () => ({}),
    });
    const user = setup();
    renderShell();
    await user.click(trigger());
    expect(dialog().style.getPropertyValue("--origin-x")).toBe("23px");
    expect(dialog().style.getPropertyValue("--origin-y")).toBe("26px");
  });

  it("closing keeps the dialog mounted for the exit animation, then unmounts it", async () => {
    const user = setup();
    renderShell();
    await user.click(trigger());
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    settle(DRAWER_REVEAL_MS - 1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    settle(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the close button and the Home link each close it", async () => {
    const user = setup();
    renderShell();
    await user.click(trigger());
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    settle(DRAWER_REVEAL_MS);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(trigger());
    await user.click(within(dialog()).getByRole("link", { name: "Home" }));
    settle(DRAWER_REVEAL_MS);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a backdrop tap closes it", async () => {
    const user = setup();
    renderShell();
    await user.click(trigger());
    await user.click(backdrop());
    settle(DRAWER_REVEAL_MS);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prefers-reduced-motion: the exit is the shorter fade, so it unmounts sooner", async () => {
    mockReducedMotion(true);
    const user = setup();
    renderShell();
    await user.click(trigger());
    await user.click(trigger());
    settle(DRAWER_FADE_MS - 1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    settle(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
