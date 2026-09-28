import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RowAction } from "./RowAction";

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

  it("tone=danger hovers to --crit, neutral to --text-primary; colour only, no fill", () => {
    render(
      <>
        <RowAction icon="Trash" label="danger" tone="danger" onClick={() => {}} />
        <RowAction icon="ExternalLink" label="neutral" onClick={() => {}} />
      </>,
    );
    const danger = screen.getByRole("button", { name: "danger" });
    const neutral = screen.getByRole("button", { name: "neutral" });
    expect(danger.style.color).toBe("var(--text-secondary)");

    // React 19 synthesises enter/leave from mouseover/mouseout (INSIGHTS).
    fireEvent.mouseOver(danger);
    fireEvent.mouseOver(neutral);

    expect(danger.style.color).toBe("var(--crit)");
    expect(neutral.style.color).toBe("var(--text-primary)");
    expect(danger.style.background).toBe("none");
  });

  it("busy disables the action", () => {
    const onClick = vi.fn();
    render(<RowAction icon="Trash" label="Delete" busy onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});
