import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Drawer } from "./Drawer";

afterEach(cleanup);

function Host({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <Drawer
          title="Example"
          subtitle="Details"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          <input aria-label="name" />
        </Drawer>
      )}
    </>
  );
}

function openIt() {
  const opener = screen.getByRole("button", { name: "open" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Drawer", () => {
  it("is a modal dialog named by its title and described by its subtitle", () => {
    render(<Host />);
    openIt();
    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Details");
  });

  it("falls back to ariaLabel when there is no title", () => {
    render(<Drawer ariaLabel="Untitled">body</Drawer>);
    expect(screen.getByRole("dialog", { name: "Untitled" })).toBeInTheDocument();
  });

  it("moves focus inside on open", () => {
    render(<Host />);
    openIt();
    // First focusable in DOM order is the header's close button.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const opener = openIt();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "name" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab inside the dialog", () => {
    render(<Host />);
    openIt();
    const input = screen.getByRole("textbox", { name: "name" });
    input.focus();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("uses closeLabel as the close button's name", () => {
    render(
      <Drawer title="T" onClose={() => {}} closeLabel="Schließen">
        body
      </Drawer>,
    );
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  });
});

describe("Drawer motion", () => {
  const origin = { x: 23, y: 26 };

  it("reveal: sets the origin vars and plays the reveal in", () => {
    render(<Drawer title="Nav" motion={{ kind: "reveal", origin, exiting: false }} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.getPropertyValue("--origin-x")).toBe("23px");
    expect(dialog.style.getPropertyValue("--origin-y")).toBe("26px");
    expect(dialog.style.animation).toContain("ddrevealin");
  });

  it("reveal exiting: plays the reveal out, ignores pointer input and stops handling Escape", () => {
    const onClose = vi.fn();
    render(<Drawer title="Nav" motion={{ kind: "reveal", origin, exiting: true }} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.animation).toContain("ddrevealout");
    expect(dialog.style.pointerEvents).toBe("none");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("default: slides in, sets no origin vars", () => {
    render(<Drawer title="Nav" side="left" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.animation).toContain("ddslideinleft");
    expect(dialog.style.getPropertyValue("--origin-x")).toBe("");
  });

  it("topInset: header keeps at least that height", () => {
    render(<Drawer title="Nav" topInset={52} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Nav" }).parentElement?.parentElement).toHaveStyle({ minHeight: "52px" });
  });
});
