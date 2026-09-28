import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Disclosure } from "./Disclosure";

afterEach(cleanup);

describe("Disclosure", () => {
  it("renders the header as a native button wired to its region", () => {
    render(<Disclosure header="Section">Body text</Disclosure>);
    const button = screen.getByRole("button", { name: "Section" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body text")).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const body = screen.getByText("Body text");
    expect(body.closest(`#${CSS.escape(button.getAttribute("aria-controls")!)}`)).not.toBeNull();
  });

  it("honours defaultOpen and passes the open state to a header function", () => {
    render(
      <Disclosure defaultOpen header={(open) => (open ? "Hide" : "Show")}>
        Body
      </Disclosure>,
    );
    expect(screen.getByText("Body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });

  it("works controlled", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Disclosure open={false} onOpenChange={onOpenChange} header="H">
        Body
      </Disclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: "H" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Still closed until the parent says otherwise.
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    rerender(
      <Disclosure open onOpenChange={onOpenChange} header="H">
        Body
      </Disclosure>,
    );
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("renders actions outside the toggle button, and clicking them does not toggle", () => {
    const onDelete = vi.fn();
    render(
      <Disclosure
        header="Run"
        actions={
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        }
      >
        Body
      </Disclosure>,
    );
    const toggle = screen.getByRole("button", { name: "Run" });
    const del = screen.getByRole("button", { name: "Delete" });
    expect(toggle).not.toContainElement(del);
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
