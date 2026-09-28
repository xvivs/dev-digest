/**
 * SkillEditorView — what the SCREEN decides: which tab ?tab= resolves to,
 * where tab changes and skill cards point, the error branch, and the AC-8
 * dirty-form navigation guard end to end (Config tab dirty → card click
 * asks first). ConfigTab/PreviewTab have their own suites. AppShell renders
 * for real (no `@/lib/repo-context` mock: with no `<RepoProvider>` in the
 * tree it falls back to its context's empty default — no repo, no crash);
 * only the skill data hooks, `next/navigation`, and — via `@/lib/hooks`'
 * spread of the real module — nothing else needs faking.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../messages/en/skills.json";
import shellMessages from "../../../../../../messages/en/shell.json";
import common from "../../../../../../messages/en/common.json";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
  skill: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown, refetch: vi.fn() },
  skills: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: h.push }),
  useSearchParams: () => new URLSearchParams(h.search),
  usePathname: () => "/skills/sk1",
}));

// AppShell's useShellContext also calls usePulls (sidebar PR-count badge) and
// useDeleteRepo (repo removal) — keep the real implementations for those and
// override only the skill hooks this screen itself reads.
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useSkills: () => ({ data: h.skills, isLoading: false, isError: false, refetch: vi.fn() }),
    useSkill: () => h.skill,
    useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
    useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
    useVetSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { SkillEditorView } from "./SkillEditorView";

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
const OTHER: Skill = {
  ...SKILL,
  id: "sk2",
  name: "route-signature-diff",
  description: "Flags breaking route changes.",
};

beforeEach(() => {
  h.replace.mockReset();
  h.push.mockReset();
  h.search = "";
  h.skills = [
    { ...SKILL, agent_count: 1 },
    { ...OTHER, agent_count: 0 },
  ];
  h.skill = { data: SKILL, isLoading: false, isError: false, error: null, refetch: vi.fn() };
});
afterEach(cleanup);

function renderView() {
  return renderWithProviders(
    <ToastProvider>
      <SkillEditorView id="sk1" />
    </ToastProvider>,
    { namespaces: { skills: messages, shell: shellMessages, common } },
  );
}

describe("SkillEditorView", () => {
  it("renders the selected skill's editor", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "branch-coverage-gate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
  });

  it("falls back to the config tab for an unknown ?tab=", () => {
    h.search = "tab=bogus";
    renderView();
    expect(screen.getByRole("link", { name: "route-signature-diff" })).toHaveAttribute(
      "href",
      "/skills/sk2?tab=config",
    );
  });

  it("marks the open skill's card as current", () => {
    renderView();
    expect(screen.getByRole("link", { name: "branch-coverage-gate" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "route-signature-diff" })).not.toHaveAttribute("aria-current");
  });

  it("writes a tab change to the URL when the form is clean", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview");
  });

  it("shows the translated error with the API message when the skill fails to load", () => {
    h.skill = { data: undefined, isLoading: false, isError: true, error: new ApiError("Skill not found", 404), refetch: vi.fn() };
    renderView();
    expect(screen.getByText("Could not load this skill.")).toBeInTheDocument();
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
  });

  it("asks for confirmation before a tab switch when the Config tab is dirty (AC-8)", () => {
    renderView();
    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("cancelling the guard keeps the tab switch from happening", () => {
    renderView();
    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("confirming the guard proceeds with the tab switch", () => {
    renderView();
    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview");
  });

  it("asks for confirmation before opening another skill's card while dirty", () => {
    renderView();
    fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
    // The link is left to itself (see SkillCard); the mouse-only card body is
    // what pushes programmatically, so click its non-interactive content.
    fireEvent.click(screen.getByText("Flags breaking route changes."));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });
});
