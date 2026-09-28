import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SearchableSelect } from "./SearchableSelect";

afterEach(cleanup);

const OPTIONS = [
  { value: "gpt-4.1", label: "GPT 4.1" },
  { value: "claude-sonnet", label: "Claude Sonnet" },
  { value: "gemini", label: "Gemini" },
];

function setup(onChange = vi.fn()) {
  render(<SearchableSelect value="gpt-4.1" onChange={onChange} options={OPTIONS} ariaLabel="Model" />);
  return { trigger: screen.getByRole("button", { name: "Model" }), onChange };
}

describe("SearchableSelect", () => {
  it("renders the trigger as a listbox button showing the current label", () => {
    const { trigger } = setup();
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("GPT 4.1");
  });

  it("opens on click and focuses the search field", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("opens from the keyboard with ArrowDown", () => {
    const { trigger } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("filters by value and label, then Enter picks the highlighted match and returns focus", () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox");

    fireEvent.change(search, { target: { value: "sonnet" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(search).toHaveAttribute("aria-activedescendant", screen.getByRole("option").id);

    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("claude-sonnet");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("ArrowDown moves the highlight", () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("claude-sonnet");
  });

  it("Escape closes without picking and returns focus to the trigger", () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("marks the current value as the selected option", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "GPT 4.1" })).toHaveAttribute("aria-selected", "true");
  });
});
