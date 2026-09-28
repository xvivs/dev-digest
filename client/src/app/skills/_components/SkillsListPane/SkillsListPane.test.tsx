import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { SkillListItem } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../messages/en/skills.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useVetSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsListPane } from "./SkillsListPane";

const SKILLS: SkillListItem[] = [
  {
    id: "sk1",
    name: "branch-coverage-gate",
    description: "Flags untested branches.",
    type: "rubric",
    source: "manual",
    body: "# a",
    enabled: true,
    version: 1,
    needs_vetting: false,
    agent_count: 2,
  },
  {
    id: "sk2",
    name: "route-signature-diff",
    description: "Flags breaking route changes.",
    type: "convention",
    source: "imported",
    body: "# b",
    enabled: false,
    version: 1,
    needs_vetting: true,
    agent_count: 0,
  },
];

function renderPane(props: Partial<React.ComponentProps<typeof SkillsListPane>> = {}) {
  return renderWithProviders(
    <SkillsListPane
      skills={SKILLS}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      onCreateClick={vi.fn()}
      onImportClick={vi.fn()}
      {...props}
    />,
    { namespaces: { skills: messages } },
  );
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("SkillsListPane", () => {
  it("renders every skill as a card", () => {
    renderPane();
    expect(screen.getByText("branch-coverage-gate")).toBeInTheDocument();
    expect(screen.getByText("route-signature-diff")).toBeInTheDocument();
  });

  it("filters the list by name and description (AC-2)", () => {
    renderPane();
    fireEvent.change(screen.getByPlaceholderText("Search skills…"), { target: { value: "breaking" } });
    expect(screen.queryByText("branch-coverage-gate")).not.toBeInTheDocument();
    expect(screen.getByText("route-signature-diff")).toBeInTheDocument();
  });

  it("shows the empty state and wires its CTA to onCreateClick", () => {
    const onCreateClick = vi.fn();
    renderPane({ skills: [], onCreateClick });
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create your first skill" }));
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it("shows an error state with retry", () => {
    const onRetry = vi.fn();
    renderPane({ isError: true, skills: undefined, onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("the Add Skill menu opens Create and Import from file", () => {
    const onCreateClick = vi.fn();
    const onImportClick = vi.fn();
    renderPane({ onCreateClick, onImportClick });
    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create" }));
    expect(onCreateClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Import from file" }));
    expect(onImportClick).toHaveBeenCalledTimes(1);
  });

  it("marks the active skill's card as current", () => {
    renderPane({ activeId: "sk1" });
    expect(screen.getByRole("link", { name: "branch-coverage-gate" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "route-signature-diff" })).not.toHaveAttribute("aria-current");
  });
});
