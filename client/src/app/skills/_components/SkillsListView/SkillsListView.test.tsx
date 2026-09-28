import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SkillListItem } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../messages/en/skills.json";
import shellMessages from "../../../../../messages/en/shell.json";

const h = vi.hoisted(() => ({
  skills: [] as SkillListItem[],
  refetch: vi.fn(),
  createMutateAsync: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.pushMock }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks", () => ({
  useSkills: () => ({ data: h.skills, isLoading: false, isError: false, refetch: h.refetch }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useVetSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: h.createMutateAsync, isPending: false }),
}));

import { SkillsListView } from "./SkillsListView";

beforeEach(() => {
  h.skills = [
    {
      id: "sk1",
      name: "existing-skill",
      description: "Flags untested branches.",
      type: "rubric",
      source: "manual",
      body: "# a",
      enabled: true,
      version: 1,
      needs_vetting: false,
      agent_count: 2,
    },
  ];
  h.refetch.mockReset();
  h.createMutateAsync.mockReset();
  h.pushMock.mockReset();
});
afterEach(cleanup);

function renderView() {
  return renderWithProviders(<SkillsListView />, { namespaces: { skills: messages, shell: shellMessages } });
}

describe("SkillsListView", () => {
  it("renders the card list and the select-a-skill prompt", () => {
    renderView();
    expect(screen.getByText("existing-skill")).toBeInTheDocument();
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
  });

  it("opens the create modal from the Add Skill menu", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create" }));
    expect(screen.getByRole("dialog", { name: "Create skill" })).toBeInTheDocument();
  });

  it("creating a skill navigates to its editor", async () => {
    h.createMutateAsync.mockResolvedValue({ id: "new1" });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create" }));
    fireEvent.change(screen.getByPlaceholderText("branch-coverage-gate"), { target: { value: "my-rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await vi.waitFor(() => expect(h.pushMock).toHaveBeenCalledWith("/skills/new1?tab=config"));
  });
});
