/**
 * AC-27 (P3): jsdom has no layout, so the sticky contract is pinned on the
 * inline style of the header row: it sticks at the PR-header offset variable,
 * on --bg-primary. The empty group is static (no button) but sticks the same.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";
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

describe("SmartDiffGroup sticky header", () => {
  it("sticks below the PR header on an opaque primary background (non-empty group)", () => {
    render(false);
    const row = screen.getByRole("button").parentElement!;
    expect(row.style.position).toBe("sticky");
    expect(row.style.top).toBe(`var(${PR_HEADER_OFFSET_VAR}, 0px)`);
    expect(row.style.background).toBe("var(--bg-primary)");
    expect(Number(row.style.zIndex)).toBeGreaterThan(0);
  });

  it("an empty group is muted, has no button and no aria-expanded, shows 0 files", () => {
    const { container } = render(true);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    expect(screen.getByText("0 files")).toBeInTheDocument();
    expect(screen.queryByText("body")).toBeNull();
  });
});
