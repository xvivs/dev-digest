import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import messages from "../../../../../../../../messages/en/skills.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import common from "../../../../../../../../messages/en/common.json";

const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  updateMutateAsync: vi.fn().mockResolvedValue(undefined),
  deleteMutate: vi.fn(),
  vetMutateAsync: vi.fn().mockResolvedValue(undefined),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.pushMock }) }));
vi.mock("@/lib/hooks", () => ({
  useUpdateSkill: () => ({
    mutate: h.updateMutate,
    mutateAsync: h.updateMutateAsync,
    isPending: false,
    isSuccess: false,
    data: undefined,
  }),
  useDeleteSkill: () => ({ mutate: h.deleteMutate, isPending: false }),
  useVetSkill: () => ({ mutateAsync: h.vetMutateAsync, isPending: false }),
}));

import { ConfigTab } from "./ConfigTab";

const SKILL: Skill = {
  id: "sk1",
  name: "branch-coverage-gate",
  description: "Flags untested branches.",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 1,
  needs_vetting: false,
};

function renderTab(skill: Skill = SKILL) {
  return renderWithProviders(
    <ToastProvider>
      <ConfigTab skill={skill} />
    </ToastProvider>,
    { namespaces: { skills: messages, shell: shellMessages, common } },
  );
}

beforeEach(() => {
  h.updateMutate.mockReset();
  h.updateMutateAsync.mockReset().mockResolvedValue(undefined);
  h.deleteMutate.mockReset();
  h.vetMutateAsync.mockReset().mockResolvedValue(undefined);
  h.pushMock.mockReset();
});
afterEach(cleanup);

describe("ConfigTab", () => {
  it("shows the token estimate for the saved body and no unsaved badge", () => {
    renderTab();
    expect(screen.getByText("≈2 tokens")).toBeInTheDocument(); // "# Rule" = 6 chars → ceil(6/4)
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("editing the body shows the unsaved badge and updates the token counter", () => {
    renderTab();
    const textarea = screen.getByDisplayValue("# Rule");
    fireEvent.change(textarea, { target: { value: "# Rule\nmore detail here" } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.getByText("≈6 tokens")).toBeInTheDocument(); // 23 chars → ceil(23/4) = 6
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("saves the full patch, including the edited body", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.updateMutate).toHaveBeenCalledWith(
      {
        id: "sk1",
        patch: {
          name: "branch-coverage-gate",
          description: "Flags untested branches.",
          type: "rubric",
          body: "# Rule v2",
          enabled: true,
        },
      },
      expect.anything(),
    );
  });

  it("toggling Enabled on an already-vetted skill just marks the draft dirty", () => {
    renderTab({ ...SKILL, enabled: false });
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("turning Enabled on for an unvetted skill opens Review & trust instead", () => {
    renderTab({ ...SKILL, enabled: false, needs_vetting: true });
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("dialog", { name: "Review & trust" })).toBeInTheDocument();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });

  it("after Trust & enable the draft follows: toggle on, not dirty, Save won't re-disable", async () => {
    const unvetted = { ...SKILL, source: "imported" as const, enabled: false, needs_vetting: true };
    const view = renderTab(unvetted);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Trust & enable" }));
    await vi.waitFor(() => expect(h.updateMutateAsync).toHaveBeenCalledWith({ id: "sk1", patch: { enabled: true } }));
    expect(h.vetMutateAsync).toHaveBeenCalledWith({ id: "sk1", version: 1 });
    // The cache update lands as a new `skill` prop.
    view.rerender(
      <ToastProvider>
        <ConfigTab skill={{ ...unvetted, enabled: true, needs_vetting: false }} />
      </ToastProvider>,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });

  it("delete asks for confirmation before mutating", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    const dialog = screen.getByRole("dialog", { name: "Delete skill" });
    expect(dialog).toHaveTextContent('Delete skill "branch-coverage-gate"? This cannot be undone.');
    fireEvent.click(screen.getAllByRole("button", { name: "Delete skill" })[1]!);
    expect(h.deleteMutate).toHaveBeenCalledWith("sk1", expect.anything());
  });

  it("sends the What changed note with the save", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
    fireEvent.change(screen.getByLabelText("What changed"), { target: { value: "stricter" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.updateMutate).toHaveBeenCalledWith(
      { id: "sk1", patch: expect.objectContaining({ body: "# Rule v2", change_note: "stricter" }) },
      expect.anything(),
    );
  });
});
