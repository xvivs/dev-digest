import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { SidebarContent } from "./SidebarContent";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Topbar logo trigger", () => {
  it("renders the logo as the nav button, first in the header, below md only", () => {
    render(<Topbar ctx={{ onToggleNav: () => {}, navDrawerId: "nav-1" }} crumb={[{ label: "Pull requests" }]} />);
    const btn = screen.getByRole("button", { name: "Open navigation" });
    expect(screen.getByRole("banner").firstElementChild).toBe(btn);
    expect(btn).toHaveTextContent("DevDigest");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls", "nav-1");
    expect(btn).toHaveClass("dd-show-below-md");
    expect(btn).toHaveStyle({ minWidth: "44px", minHeight: "44px" });
  });

  it("flips to the close label and aria-expanded while open, layered above the drawer", () => {
    render(<Topbar ctx={{ onToggleNav: () => {}, navOpen: true, labels: { closeNav: "Close nav" } }} />);
    const btn = screen.getByRole("button", { name: "Close nav" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(Number(btn.style.zIndex)).toBeGreaterThan(50);
  });

  it("passes the mark's centre (from getBoundingClientRect) to onToggleNav", () => {
    const onToggleNav = vi.fn();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 10, top: 20, width: 22, height: 22, right: 32, bottom: 42, x: 10, y: 20, toJSON: () => ({}),
    });
    render(<Topbar ctx={{ onToggleNav }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onToggleNav).toHaveBeenCalledWith({ x: 21, y: 31 });
  });

  it("renders no trigger without onToggleNav (nothing to open)", () => {
    render(<Topbar ctx={{}} />);
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });

  it("keeps crumbs and the bell for desktop only", () => {
    render(<Topbar ctx={{}} crumb={[{ label: "Pull requests" }]} />);
    expect(screen.getByText("Pull requests").closest(".dd-hide-below-md")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Notifications" })).toHaveClass("dd-hide-below-md");
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
