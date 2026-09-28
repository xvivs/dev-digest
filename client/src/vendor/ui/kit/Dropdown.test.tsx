import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Dropdown } from "./Dropdown";
import { Button } from "../primitives";

afterEach(cleanup);

function setup(extra?: { onRemove?: () => void; onRun?: () => void }) {
  render(
    <Dropdown
      trigger={<Button>Menu</Button>}
      items={[
        { label: "Run", onClick: extra?.onRun },
        { divider: true },
        { label: "Repo", onRemove: extra?.onRemove, removeLabel: "Remove Repo" },
        { label: "Configure" },
      ]}
    />,
  );
  return screen.getByRole("button", { name: "Menu" });
}

describe("Dropdown", () => {
  it("marks the trigger as a menu button and reflects open state", () => {
    const trigger = setup();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger, { detail: 1 });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
  });

  it("opens with ArrowDown and focuses the first item; arrows rove and wrap", () => {
    const trigger = setup({ onRemove: () => {} });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const run = screen.getByRole("menuitem", { name: "Run" });
    expect(run).toHaveFocus();

    fireEvent.keyDown(run, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Repo" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Remove Repo" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Configure" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(run).toHaveFocus();
    fireEvent.keyDown(run, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Configure" })).toHaveFocus();
  });

  it("ArrowUp on the trigger opens with the last item focused", () => {
    const trigger = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Configure" })).toHaveFocus();
  });

  it("a keyboard click (Enter/Space) opens with the first item focused", () => {
    const trigger = setup();
    trigger.focus();
    fireEvent.click(trigger, { detail: 0 });
    expect(screen.getByRole("menuitem", { name: "Run" })).toHaveFocus();
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    const trigger = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Run" }), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("activating an item runs it and closes the menu", () => {
    const onRun = vi.fn();
    const trigger = setup({ onRun });
    fireEvent.click(trigger, { detail: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Run" }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("the remove action is its own control and does not trigger the item", () => {
    const onRemove = vi.fn();
    const trigger = setup({ onRemove });
    fireEvent.click(trigger, { detail: 1 });
    const remove = screen.getByRole("menuitem", { name: "Remove Repo" });
    // Not nested inside the item's own button.
    expect(screen.getByRole("menuitem", { name: "Repo" })).not.toContainElement(remove);
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a trigger with nothing focusable falls back to a keyboard-operable wrapper", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Dropdown trigger={<span>Plain</span>} items={[{ label: "One" }]} />);
    const trigger = screen.getByRole("button", { name: "Plain" });
    expect(trigger).toHaveAttribute("tabindex", "0");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("menuitem", { name: "One" })).toHaveFocus();
    warn.mockRestore();
  });
});

describe("Dropdown — disabled trigger", () => {
  it("keeps ARIA on a disabled Button and never turns the wrapper into a second button", () => {
    const items = [{ label: "Run", onClick: () => {} }];
    const { rerender } = render(<Dropdown trigger={<Button disabled>Menu</Button>} items={items} />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getAllByRole("button")).toHaveLength(1);

    rerender(<Dropdown trigger={<Button>Menu</Button>} items={items} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });
});
