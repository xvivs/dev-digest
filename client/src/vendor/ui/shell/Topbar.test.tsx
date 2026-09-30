import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Topbar } from "./Topbar";
import { SidebarContent } from "./SidebarContent";

afterEach(cleanup);

describe("Topbar logo", () => {
  it("renders the logo centered, visible below md only", () => {
    render(<Topbar ctx={{ onOpenNav: () => {} }} crumb={[{ label: "Pull requests" }]} />);
    const wrapper = screen.getByText("DevDigest").closest(".dd-show-below-md") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.left).toBe("50%");
    expect(wrapper.style.transform).toBe("translate(-50%, -50%)");
    expect(screen.getByRole("banner")).toHaveStyle({ position: "relative" });
  });

  it("keeps crumbs for desktop only", () => {
    render(<Topbar ctx={{}} crumb={[{ label: "Pull requests" }]} />);
    expect(screen.getByText("Pull requests").closest(".dd-hide-below-md")).not.toBeNull();
  });
});

describe("SidebarContent logo", () => {
  it("shows the logo by default (desktop sidebar)", () => {
    render(<SidebarContent ctx={{}} />);
    expect(screen.getByText("DevDigest")).toBeInTheDocument();
  });

  it("omits the logo when hideLogo is set (drawer already shows it)", () => {
    render(<SidebarContent ctx={{}} hideLogo />);
    expect(screen.queryByText("DevDigest")).not.toBeInTheDocument();
  });
});
