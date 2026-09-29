import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Checkbox } from "./Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is named by aria-label when there is no visible label", () => {
    render(<Checkbox checked={false} aria-label="Select the rule" />);
    expect(screen.getByRole("checkbox", { name: "Select the rule" })).toHaveAttribute("aria-checked", "false");
  });

  it("is named by its visible label otherwise", () => {
    render(<Checkbox checked label="On new PR" />);
    expect(screen.getByRole("checkbox", { name: "On new PR" })).toHaveAttribute("aria-checked", "true");
  });

  it("reports the toggled value", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} aria-label="x" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
