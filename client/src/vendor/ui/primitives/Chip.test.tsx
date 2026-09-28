import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Chip, chipColors } from "./Chip";

afterEach(cleanup);

describe("Chip", () => {
  it("is a plain button with no pressed state when `active` is undefined", () => {
    render(<Chip>Add</Chip>);
    const chip = screen.getByRole("button", { name: "Add" });
    expect(chip).toHaveAttribute("type", "button");
    expect(chip).not.toHaveAttribute("aria-pressed");
  });

  it("derives aria-pressed from `active`", () => {
    const { rerender } = render(<Chip active={false}>Open</Chip>);
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "false");
    rerender(<Chip active>Open</Chip>);
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an explicit aria-pressed wins over `active`", () => {
    render(
      <Chip active aria-pressed={false}>
        X
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "X" })).toHaveAttribute("aria-pressed", "false");
  });

  it("disabled blocks clicks", () => {
    const onClick = vi.fn();
    render(
      <Chip disabled onClick={onClick}>
        Off
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Off" });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

});

describe("chipColors", () => {
  const base = { active: false, disabled: false, hot: false };
  it("idle, hover and disabled use the neutral tokens", () => {
    expect(chipColors(base)).toEqual({ border: "var(--border)", background: "transparent", fg: "var(--text-secondary)" });
    expect(chipColors({ ...base, hot: true })).toMatchObject({ background: "var(--bg-hover)", fg: "var(--text-primary)" });
    expect(chipColors({ ...base, disabled: true }).fg).toBe("var(--text-muted)");
  });
  it("active uses the accent unless activeColor replaces it", () => {
    expect(chipColors({ ...base, active: true })).toEqual({
      border: "var(--accent)",
      background: "var(--accent-bg)",
      fg: "var(--accent-text)",
    });
    expect(chipColors({ ...base, active: true, activeColor: "var(--warn)" })).toEqual({
      border: "var(--warn)",
      background: "var(--bg-hover)",
      fg: "var(--warn)",
    });
  });
});
