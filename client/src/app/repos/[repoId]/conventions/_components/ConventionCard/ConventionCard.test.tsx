/**
 * ConventionCard — what one card promises (AC-33, AC-35..AC-40): verified
 * evidence with a pinned GitHub link and a labelled copy button, pressed-state
 * Accept/Reject, a checkbox named by the rule, inline edit that leaves evidence
 * read-only, and a confirm before rejecting a convention that is in a skill.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../messages/en/conventions.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { candidate } from "../../fixtures";
import { ConventionCard } from "./ConventionCard";

// The card is presentational: its callback props ARE its contract, so they are plain spies.
const h = vi.hoisted(() => ({
  onDecide: vi.fn(),
  onEdit: vi.fn(),
  onSelectedChange: vi.fn(),
}));

beforeEach(() => {
  h.onDecide.mockReset();
  h.onEdit.mockReset();
  h.onSelectedChange.mockReset();
});
afterEach(cleanup);

type User = ReturnType<typeof userEvent.setup>;

/** Replaces the whole value of a text field, the way a paste over a select-all would. */
async function replaceText(user: User, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.paste(text);
}

function renderCard(over: Partial<Parameters<typeof candidate>[1]> = {}, props: { selectable?: boolean; selected?: boolean; repoFullName?: string | null } = {}) {
  const c = candidate("c1", { rule: "Always use async/await instead of .then() chains", ...over });
  renderWithProviders(
    <ConventionCard
      candidate={c}
      repoFullName={props.repoFullName === undefined ? "acme/payments-api" : props.repoFullName}
      selectable={props.selectable ?? false}
      selected={props.selected ?? false}
      onSelectedChange={h.onSelectedChange}
      onDecide={h.onDecide}
      onEdit={h.onEdit}
    />,
    { namespaces: { conventions: messages, shell: shellMessages } },
  );
  return c;
}

describe("ConventionCard content", () => {
  it("shows the rule, category, snippet and a whole-percent confidence", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Always use async/await instead of .then() chains" })).toBeInTheDocument();
    expect(screen.getByText("async")).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("links the evidence to GitHub at the pinned commit and cited lines (AC-35)", () => {
    renderCard();
    expect(screen.getByRole("link", { name: "src/api/users.ts:23-31" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc1234/src/api/users.ts#L23-L31",
    );
  });

  it("uses the last-seen commit for a card the latest scan no longer saw", () => {
    renderCard({ seen_in_latest: false, last_seen_commit_sha: "old9999" });
    expect(screen.getByRole("link", { name: "src/api/users.ts:23-31" })).toHaveAttribute(
      "href",
      expect.stringContaining("/blob/old9999/"),
    );
    expect(screen.getByText("not seen in latest scan")).toBeInTheDocument();
  });

  it("renders plain text, not a dead link, when there is no commit or repo name", () => {
    renderCard({ last_seen_commit_sha: null });
    expect(screen.queryByRole("link", { name: "src/api/users.ts:23-31" })).not.toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
  });

  it("shows the edited, in-skill, flagged and cited badges (AC-33)", () => {
    renderCard({
      edited: true,
      review_hits: 3,
      skills: [{ id: "sk1", name: "payments-api-conventions" }],
      evidence: [
        { path: "a.ts", line_start: 1, line_end: 2, snippet: "one" },
        { path: "b.ts", line_start: 3, line_end: 4, snippet: "two" },
      ],
    });
    expect(screen.getByText("edited")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "in: payments-api-conventions" })).toHaveAttribute("href", "/skills/sk1?tab=config");
    expect(screen.getByText("flagged in 3 reviews")).toBeInTheDocument();
    expect(screen.getByText("2 cited examples")).toBeInTheDocument();
  });

  it("hides the optional badges when they do not apply", () => {
    renderCard({ review_hits: 0, edited: false });
    expect(screen.queryByText("edited")).not.toBeInTheDocument();
    expect(screen.queryByText(/flagged in/)).not.toBeInTheDocument();
    expect(screen.queryByText("not seen in latest scan")).not.toBeInTheDocument();
    expect(screen.getByText("1 cited example")).toBeInTheDocument();
  });
});

describe("ConventionCard accessibility (AC-35, AC-39, AC-40)", () => {
  it("labels the copy button and copies the real snippet", async () => {
    const user = userEvent.setup(); // installs a working clipboard on navigator
    renderCard();
    await user.click(screen.getByRole("button", { name: "Copy snippet from src/api/users.ts:23-31" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("const user = await db.users.find(id);");
  });

  it("shows no confirmation when the clipboard refuses", async () => {
    const user = userEvent.setup();
    const refused = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderCard();
    await user.click(screen.getByRole("button", { name: /Copy snippet/ }));
    await waitFor(() => expect(refused).toHaveBeenCalled());
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("has a checkbox named by the rule only when selectable", async () => {
    const user = userEvent.setup();
    renderCard({}, { selectable: false });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    cleanup();
    renderCard({}, { selectable: true, selected: true });
    const box = screen.getByRole("checkbox", { name: "Always use async/await instead of .then() chains" });
    expect(box).toHaveAttribute("aria-checked", "true");
    await user.click(box);
    expect(h.onSelectedChange).toHaveBeenCalledWith("c1", false);
  });

  it("exposes Accept and Reject as pressed toggles", () => {
    renderCard({ status: "accepted" });
    expect(screen.getByRole("button", { name: "Accepted" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Reject" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ConventionCard decisions (AC-36)", () => {
  it("accepts a pending card", async () => {
    const user = userEvent.setup();
    renderCard({ status: "pending" });
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(h.onDecide).toHaveBeenCalledWith("c1", "accepted");
  });

  it("returns an accepted card to pending on a second click", async () => {
    const user = userEvent.setup();
    renderCard({ status: "accepted" });
    await user.click(screen.getByRole("button", { name: "Accepted" }));
    expect(h.onDecide).toHaveBeenCalledWith("c1", "pending");
  });

  it("rejects at once when the convention is in no skill", async () => {
    const user = userEvent.setup();
    renderCard({ status: "pending", skills: [] });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(h.onDecide).toHaveBeenCalledWith("c1", "rejected");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores a rejected card to pending without a confirm", async () => {
    const user = userEvent.setup();
    renderCard({ status: "rejected", skills: [{ id: "sk1", name: "s" }] });
    await user.click(screen.getByRole("button", { name: "Rejected" }));
    expect(h.onDecide).toHaveBeenCalledWith("c1", "pending");
  });
});

describe("ConventionCard reject confirm (AC-38)", () => {
  const inSkill = { status: "accepted" as const, skills: [{ id: "sk1", name: "payments-api-conventions" }] };

  it("asks first, says the skill keeps the rule, and links to it", async () => {
    const user = userEvent.setup();
    renderCard(inSkill);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog", { name: "Reject this convention?" });
    expect(within(dialog).getByText(/the skill keeps this rule/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "payments-api-conventions" })).toHaveAttribute("href", "/skills/sk1?tab=config");
    expect(h.onDecide).not.toHaveBeenCalled();
  });

  it("rejects only after the person confirms", async () => {
    const user = userEvent.setup();
    renderCard(inSkill);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Reject anyway" }));
    expect(h.onDecide).toHaveBeenCalledWith("c1", "rejected");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("changes nothing on cancel", async () => {
    const user = userEvent.setup();
    renderCard(inSkill);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(h.onDecide).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConventionCard inline edit (AC-37)", () => {
  it("saves a new rule and category, and evidence has no editor", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Edit rule" }));
    // Evidence stays read-only: the only textarea is the rule.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();

    await replaceText(user, screen.getByRole("textbox", { name: "Rule" }), "  Prefer async/await everywhere  ");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "typing");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(h.onEdit).toHaveBeenCalledWith("c1", { rule: "Prefer async/await everywhere", category: "typing" });
    expect(screen.queryByRole("textbox", { name: "Rule" })).not.toBeInTheDocument();
  });

  it("keeps Save disabled until the change is valid", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Edit rule" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // unchanged
    await replaceText(user, screen.getByRole("textbox", { name: "Rule" }), "short");
    expect(save).toBeDisabled(); // under 8 characters
    await replaceText(user, screen.getByRole("textbox", { name: "Rule" }), "x".repeat(301));
    expect(save).toBeDisabled(); // over 300
    await replaceText(user, screen.getByRole("textbox", { name: "Rule" }), "long enough now");
    expect(save).toBeEnabled();
  });

  it("discards the draft on Cancel and on Escape", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Edit rule" }));
    await replaceText(user, screen.getByRole("textbox", { name: "Rule" }), "a different rule text");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Always use async/await instead of .then() chains" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit rule" }));
    await user.click(screen.getByRole("textbox", { name: "Rule" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Rule" })).not.toBeInTheDocument();
    expect(h.onEdit).not.toHaveBeenCalled();
  });
});
