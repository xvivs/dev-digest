import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Chip } from "./Chip";

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

  it("activeColor replaces the accent on the active state", () => {
    render(
      <Chip active activeColor="var(--warn)">
        Warning
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Warning" });
    expect(chip.style.color).toBe("var(--warn)");
    expect(chip.style.border).toContain("var(--warn)");
  });
});
