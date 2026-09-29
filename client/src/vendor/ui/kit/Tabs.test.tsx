import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

afterEach(cleanup);

const TABS = [{ key: "all", label: "All", count: 3 }, { key: "accepted", label: "Accepted", count: 1 }, "Rejected"];

describe("Tabs", () => {
  it("is a tablist whose children are tabs, with the active one selected", () => {
    render(<Tabs tabs={TABS} value="accepted" onChange={() => {}} ariaLabel="Filter" />);
    expect(screen.getByRole("tablist", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /^Accepted/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Rejected" })).toHaveAttribute("aria-selected", "false");
  });

  it("reports the clicked tab's key", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /^Accepted/ }));
    expect(onChange).toHaveBeenCalledWith("accepted");
  });

  it("shows counts next to labels", () => {
    render(<Tabs tabs={TABS} value="all" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveTextContent("All3");
  });

  it("names a counted tab with a separator and hides the bare count from the name", () => {
    render(<Tabs tabs={TABS} value="all" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "All (3)" })).toBeInTheDocument();
    expect(screen.getByText("3")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("tab", { name: "Rejected" })).not.toHaveAttribute("aria-label");
  });

  it("uses a caller-supplied countLabel as the accessible name", () => {
    render(<Tabs tabs={[{ key: "all", label: "All", count: 3, countLabel: "All, 3 items" }]} value="all" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "All, 3 items" })).toBeInTheDocument();
  });
});
