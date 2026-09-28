import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import prReviewMessages from "../../../../../../../messages/en/prReview.json";
import { FilterBar } from "./FilterBar";

afterEach(cleanup);

function renderBar(over: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  const props: React.ComponentProps<typeof FilterBar> = {
    active: "needs_review",
    onActive: vi.fn(),
    query: "",
    onQuery: vi.fn(),
    sort: "newest",
    onSort: vi.fn(),
    onRefresh: vi.fn(),
    refreshing: false,
    ...over,
  };
  renderWithProviders(<FilterBar {...props} />, { namespaces: { prReview: prReviewMessages } });
  return props;
}

describe("FilterBar", () => {
  it("exposes the status chips as a labelled toggle group with the active one pressed", () => {
    renderBar({ active: "reviewed" });
    const group = screen.getByRole("group", { name: "Filter by status" });
    expect(within(group).getByRole("button", { name: "Reviewed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of ["All", "Needs review", "Stale"]) {
      expect(within(group).getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("reports the picked status key, not its label", () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(props.onActive).toHaveBeenCalledWith("all");
  });

  it("forwards a known sort order from the select", () => {
    const props = renderBar();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "oldest" } });
    expect(props.onSort).toHaveBeenCalledWith("oldest");
  });

  it("labels the search box for assistive tech and reports what is typed", () => {
    const props = renderBar();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search pull requests by title or number" }),
      { target: { value: "cost" } },
    );
    expect(props.onQuery).toHaveBeenCalledWith("cost");
  });

  it("disables refresh and says so while a refresh is in flight", () => {
    renderBar({ refreshing: true });
    expect(screen.getByRole("button", { name: /Refreshing/ })).toBeDisabled();
  });
});
