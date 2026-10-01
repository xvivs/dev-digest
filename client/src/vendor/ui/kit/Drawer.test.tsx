import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

async function openIt(user: ReturnType<typeof userEvent.setup>) {
  const opener = screen.getByRole("button", { name: "open" });
  await user.click(opener); // a real click focuses the opener, which is what Drawer restores
  return opener;
}

describe("Drawer", () => {
  it("is a modal dialog named by its title and described by its subtitle", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openIt(user);
    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Details");
  });

  it("falls back to ariaLabel when there is no title", () => {
    render(<Drawer ariaLabel="Untitled">body</Drawer>);
    expect(screen.getByRole("dialog", { name: "Untitled" })).toBeInTheDocument();
  });

  it("moves focus inside on open", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openIt(user);
    // First focusable in DOM order is the header's close button.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const opener = await openIt(user);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openIt(user);
    await user.click(screen.getByRole("textbox", { name: "name" }));
    expect(screen.getByRole("textbox", { name: "name" })).toHaveFocus();
    await user.tab();
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

  it("reveal: content is visible and Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Drawer title="Nav" motion={{ kind: "reveal", origin, exiting: false }} onClose={onClose}>
        <p>menu</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "Nav" })).toBeInTheDocument();
    expect(screen.getByText("menu")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reveal exiting: content stays visible but Escape no longer calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Drawer title="Nav" motion={{ kind: "reveal", origin, exiting: true }} onClose={onClose}>
        <p>menu</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "Nav" })).toBeInTheDocument();
    expect(screen.getByText("menu")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("default (no motion): Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer title="Nav" side="left" onClose={onClose} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Not asserted (visual, browser-verified): the reveal origin, slide/reveal/fade animations, pointer-events while
  // exiting, and the topInset header min-height.
});
