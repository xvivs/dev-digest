import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CommandPalette, type Command } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";

afterEach(cleanup);

function Host({ commands }: { commands: Command[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open palette
      </button>
      <CommandPalette open={open} commands={commands} onClose={() => setOpen(false)} />
    </>
  );
}

describe("CommandPalette", () => {
  it("focuses the search field on open, Escape closes and restores focus", () => {
    render(<Host commands={[{ id: "a", label: "Go to Agents", run: () => {} }]} />);
    const opener = screen.getByRole("button", { name: "open palette" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog", { name: "Command palette" })).toHaveAttribute("aria-modal", "true");
    const input = screen.getByPlaceholderText("Type a command or search…");
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("filters, moves the selection with arrows and runs it with Enter", () => {
    const runA = vi.fn();
    const runB = vi.fn();
    render(
      <Host
        commands={[
          { id: "a", label: "Go to Agents", run: runA },
          { id: "b", label: "Go to Pull Requests", run: runB },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "open palette" }));
    const input = screen.getByPlaceholderText("Type a command or search…");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runB).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "open palette" }));
    fireEvent.change(screen.getByPlaceholderText("Type a command or search…"), { target: { value: "agents" } });
    expect(screen.getAllByRole("button", { name: /Go to/ })).toHaveLength(1);
  });
});

describe("ShortcutsHelp", () => {
  it("is a labelled modal dialog that closes on Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp open onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
