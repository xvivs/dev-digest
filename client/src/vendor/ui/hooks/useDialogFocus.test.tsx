import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useDialogFocus } from "./useDialogFocus";

afterEach(cleanup);

function Dialog({
  onClose,
  label = "Dialog",
  children,
}: {
  onClose?: () => void;
  label?: string;
  children?: React.ReactNode;
}) {
  const ref = useDialogFocus<HTMLDivElement>({ onClose });
  return (
    <div ref={ref} role="dialog" aria-label={label} tabIndex={-1}>
      {children ?? (
        <>
          <button type="button">first</button>
          <button type="button">last</button>
        </>
      )}
    </div>
  );
}

function Host({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open && (
        <Dialog
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

describe("useDialogFocus", () => {
  it("moves focus to the first focusable element on open", () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("focuses the dialog itself when it has nothing focusable", () => {
    render(<Dialog>plain text</Dialog>);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("calls onClose on Escape and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(screen.getByRole("button", { name: "first" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("ignores an Escape an inner control already handled", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose}>
        <input aria-label="inner" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "inner" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wraps Tab from the last element to the first, and Shift+Tab back", () => {
    render(<Dialog />);
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("only the innermost dialog reacts to Escape", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Dialog label="outer" onClose={outer}>
        <button type="button">outer button</button>
        <Dialog label="inner" onClose={inner} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "first" }), { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("useDialogFocus — autoFocus opener", () => {
  it("restores focus to the opener even when a field inside autoFocuses", () => {
    function Dlg({ onClose }: { onClose: () => void }) {
      const ref = useDialogFocus<HTMLDivElement>({ onClose });
      return (
        <div role="dialog" tabIndex={-1} ref={ref}>
          <input aria-label="inner" autoFocus />
        </div>
      );
    }
    function App() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && <Dlg onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<App />);
    const opener = screen.getByText("opener");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("inner"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
