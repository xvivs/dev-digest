import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { SidebarContent } from "./SidebarContent";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Topbar logo trigger", () => {
  it("renders the logo as the nav button, in the header, wired to its drawer", () => {
    render(<Topbar ctx={{ onToggleNav: () => {}, navDrawerId: "nav-1" }} crumb={[{ label: "Pull requests" }]} />);
    const btn = screen.getByRole("button", { name: "Open navigation" });
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Open navigation" })).toBe(btn);
    expect(btn).toHaveTextContent("DevDigest");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls", "nav-1");
  });

  it("flips to the close label and aria-expanded while open", () => {
    render(<Topbar ctx={{ onToggleNav: () => {}, navOpen: true, labels: { closeNav: "Close nav" } }} />);
    const btn = screen.getByRole("button", { name: "Close nav" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("passes the mark's centre (from getBoundingClientRect) to onToggleNav", async () => {
    const user = userEvent.setup();
    const onToggleNav = vi.fn();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 10, top: 20, width: 22, height: 22, right: 32, bottom: 42, x: 10, y: 20, toJSON: () => ({}),
    });
    render(<Topbar ctx={{ onToggleNav }} />);
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onToggleNav).toHaveBeenCalledWith({ x: 21, y: 31 });
  });

  it("renders no trigger without onToggleNav (nothing to open)", () => {
    render(<Topbar ctx={{}} />);
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });

  it("still renders the crumbs and the notifications bell", () => {
    render(<Topbar ctx={{}} crumb={[{ label: "Pull requests" }]} />);
    expect(screen.getByText("Pull requests")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    // Desktop-only visibility (the hide-below-md utility) needs real media queries: browser-verified.
  });
});

describe("logo placement", () => {
  it("desktop Sidebar links the logo home", () => {
    render(<Sidebar ctx={{}} />);
    expect(screen.getByText("DevDigest").closest("a")).toHaveAttribute("href", "/");
  });

  it("SidebarContent has no logo of its own", () => {
    render(<SidebarContent ctx={{}} />);
    expect(screen.queryByText("DevDigest")).not.toBeInTheDocument();
  });
});
