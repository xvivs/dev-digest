import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import shellMessages from "../../../messages/en/shell.json";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("./hooks", async () => {
  const React = await import("react");
  return {
    useGlobalShortcuts: () => {},
    useShellCommands: () => [],
    useShellContext: ({ onToggleNav, navOpen, navDrawerId }: Record<string, unknown>) =>
      React.useMemo(
        () => ({ onToggleNav, navOpen, navDrawerId, labels: { openNav: "Open navigation", closeNav: "Close navigation" } }),
        [onToggleNav, navOpen, navDrawerId],
      ),
  };
});

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // @ts-expect-error restore jsdom's lack of matchMedia
  delete window.matchMedia;
});

function renderShell() {
  renderWithProviders(<AppShell>content</AppShell>, { namespaces: { shell: shellMessages } });
}
const trigger = () => screen.getByRole("button", { name: /^(Open|Close) navigation$/ });
const settle = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("AppShell logo trigger", () => {
  it("renders the trigger (mobile) and the desktop sidebar logo; no dialog until opened", () => {
    renderShell();
    expect(trigger()).toHaveClass("dd-show-below-md");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("DevDigest")).toHaveLength(2); // trigger + desktop sidebar
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a dialog named exactly 'Navigation' with no second logo, wired to the trigger", () => {
    renderShell();
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(dialog).queryByText("DevDigest")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAccessibleName("Close navigation");
    expect(trigger().getAttribute("aria-controls")).toBe(dialog.id);
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("sets the reveal origin CSS vars from the mark's rect", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 12, top: 15, width: 22, height: 22, right: 34, bottom: 37, x: 12, y: 15, toJSON: () => ({}),
    });
    renderShell();
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.getPropertyValue("--origin-x")).toBe("23px");
    expect(dialog.style.getPropertyValue("--origin-y")).toBe("26px");
    expect(dialog.style.animation).toContain("ddrevealin");
  });

  it("clicking the logo again closes: exit animation, then unmount", () => {
    renderShell();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("dialog").style.animation).toContain("ddrevealout");
    settle(420);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape closes and returns focus to the logo button", () => {
    renderShell();
    trigger().focus();
    fireEvent.click(trigger());
    expect(trigger()).not.toHaveFocus(); // focus moved into the dialog
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger()).toHaveFocus();
    settle(420);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("backdrop tap, the close button and the Home link each close it", () => {
    renderShell();
    fireEvent.click(trigger());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    settle(420);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger());
    const home = within(screen.getByRole("dialog")).getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/");
    fireEvent.click(home);
    settle(420);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.previousElementSibling as HTMLElement);
    settle(420);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prefers-reduced-motion: opacity fade instead of the clip-path reveal, shorter unmount", () => {
    mockReducedMotion(true);
    renderShell();
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.animation).toContain("ddfadein");
    expect(dialog.style.animation).not.toContain("reveal");
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog").style.animation).toContain("ddfadeout");
    settle(150);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
