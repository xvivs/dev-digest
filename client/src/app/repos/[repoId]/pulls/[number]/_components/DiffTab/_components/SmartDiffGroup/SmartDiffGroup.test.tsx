/**
 * SmartDiffGroup: roles, names and disclosure state. The sticky offset (header
 * row pinned below the PR header) needs real layout; it is browser-verified,
 * not asserted on inline styles here.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { SmartDiffGroup } from "./SmartDiffGroup";

const render = (isEmpty: boolean) =>
  renderWithProviders(
    <SmartDiffGroup
      group={{ role: "core", isEmpty, files: isEmpty ? [] : [{ path: "a.ts", additions: 1, deletions: 0, patch: null }] }}
      filesWithFindings={null}
    >
      <p>body</p>
    </SmartDiffGroup>,
    { namespaces: { prReview } },
  );

describe("SmartDiffGroup", () => {
  it("a non-empty group is an open disclosure button that collapses its body", async () => {
    const user = userEvent.setup();
    render(false);
    const toggle = screen.getByRole("button", { name: /Core logic/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("1 file");
    expect(screen.getByText("body")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body")).toBeNull();
  });

  it("an empty group is muted: no button, no body, shows 0 files", () => {
    render(true);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("0 files")).toBeInTheDocument();
    expect(screen.queryByText("body")).toBeNull();
  });
});
