import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RowAction, rowActionColor } from "./RowAction";

afterEach(cleanup);

describe("RowAction", () => {
  it("is an icon-only button named by its label", () => {
    render(<RowAction icon="Trash" label="Delete run" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "Delete run" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("title", "Delete run");
  });

  it("does not let the click reach a clickable row", () => {
    const onRow = vi.fn();
    const onClick = vi.fn();
    render(
      <div onClick={onRow}>
        <RowAction icon="Trash" label="Delete" onClick={onClick} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("busy disables the action", () => {
    const onClick = vi.fn();
    render(<RowAction icon="Trash" label="Delete" busy onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("rowActionColor", () => {
  it("rests on --text-secondary; hover goes --crit for danger, --text-primary for neutral", () => {
    expect(rowActionColor("danger", false)).toBe("var(--text-secondary)");
    expect(rowActionColor("neutral", false)).toBe("var(--text-secondary)");
    expect(rowActionColor("danger", true)).toBe("var(--crit)");
    expect(rowActionColor("neutral", true)).toBe("var(--text-primary)");
  });
});
