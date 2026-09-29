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
import evalMessages from "../../../../../../messages/en/eval.json";
import costMessages from "../../../../../../messages/en/cost.json";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
  skill: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown, refetch: vi.fn() },
  skills: [] as unknown[],
  versions: [] as unknown[],
  statsWindow: null as string | null,
  evalCases: [] as unknown[],
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
    useSkillVersions: () => ({ data: h.versions, isLoading: false, isError: false, refetch: vi.fn() }),
    useSkillVersion: () => ({ data: undefined, isLoading: false, isError: false }),
    useRestoreSkillVersion: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
    // Evals tab: no cases, no suites, no agents — enough to mount it and its Run modal.
    useSkillEvalCases: () => ({ data: h.evalCases, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() }),
    useEvalCaseDetail: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
    useSkillEvalSuites: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
    useEvalSuite: () => ({ data: undefined }),
    useCancelEvalSuite: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateEvalSuite: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, data: undefined, error: null }),
    useStartEvalSuite: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
    useAgents: () => ({ data: [], isSuccess: true }),
    useSkillStats: (_id: string, window: string) => {
      h.statsWindow = window;
      return {
        data: {
          skill_id: "sk1",
          window,
          usage: { runs: 0, agents: [] },
          cost: { tokens: 0, cost_usd: null, cost_source: null },
          by_version: [],
          impact: null,
        },
        isLoading: false,
        isError: false,
        isPlaceholderData: false,
        refetch: vi.fn(),
      };
    },
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
  h.versions = [];
  h.statsWindow = null;
  h.evalCases = [];
});
afterEach(cleanup);

function renderView() {
  return renderWithProviders(
    <ToastProvider>
      <SkillEditorView id="sk1" />
    </ToastProvider>,
    { namespaces: { skills: messages, shell: shellMessages, common, eval: evalMessages, cost: costMessages } },
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

  describe("header Run on evals", () => {
    it("switches to the Evals tab from another tab", () => {
      renderView();
      fireEvent.click(screen.getByRole("button", { name: "Run on evals" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
    });

    it("on the Evals tab, opens the Run modal", () => {
      h.search = "tab=evals";
      renderView();
      fireEvent.click(screen.getByRole("button", { name: "Run on evals" }));
      expect(screen.getByRole("dialog", { name: "Run on evals" })).toBeInTheDocument();
      expect(h.replace).not.toHaveBeenCalled();
    });

    it("asks before leaving a dirty Config", () => {
      renderView();
      fireEvent.change(screen.getByDisplayValue("# Rule"), { target: { value: "# Rule v2" } });
      fireEvent.click(screen.getByRole("button", { name: "Run on evals" }));
      expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
      expect(h.replace).not.toHaveBeenCalled();
    });
  });

  describe("Stats window (?window=)", () => {
    const cost = { exact: "", estimated: "", missing: { pending: "", failed: "", no_price: "", default: "" } };
    const renderStats = () =>
      renderWithProviders(
        <ToastProvider>
          <SkillEditorView id="sk1" />
        </ToastProvider>,
        { namespaces: { skills: messages, shell: shellMessages, common, cost } },
      );

    it("reads the window from the URL and defaults to 30d", () => {
      h.search = "tab=stats";
      renderStats();
      expect(h.statsWindow).toBe("30d");
      cleanup();
      h.search = "tab=stats&window=90d";
      renderStats();
      expect(h.statsWindow).toBe("90d");
      expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
    });

    it("writes a window change to the URL, keeping the tab", () => {
      h.search = "tab=stats";
      renderStats();
      fireEvent.click(screen.getByRole("button", { name: "7d" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=stats&window=7d");
    });

    it("keeps the window across a tab switch", () => {
      h.search = "tab=stats&window=7d";
      renderStats();
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview&window=7d");
    });

    it("the Impact CTA opens the Evals tab", () => {
      h.search = "tab=stats";
      renderStats();
      fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
    });
  });
});

describe("SkillEditorView — eval case drawer (?case=)", () => {
  const CASE = {
    id: "c1",
    owner_kind: "skill",
    owner_id: "sk1",
    skill_id: "sk1",
    name: "stripe-key-leak",
    input_diff: "+a",
    input_files: null,
    input_meta: null,
    expected_output: {},
    expectation: { must_find: [{ file: "a.ts", min_severity: "CRITICAL", category: "security" }], must_not_find: [] },
    input_source: { kind: "paste" },
    notes: null,
  };

  it("?tab=evals&case=<id> opens the drawer on load", () => {
    h.search = "tab=evals&case=c1";
    h.evalCases = [CASE];
    renderView();
    expect(screen.getByRole("dialog", { name: "Eval case details" })).toBeInTheDocument();
  });

  it("?case= is ignored outside the Evals tab", () => {
    h.search = "tab=config&case=c1";
    h.evalCases = [CASE];
    renderView();
    expect(screen.queryByRole("dialog", { name: "Eval case details" })).not.toBeInTheDocument();
  });

  it("opening a card pushes ?case= so Back closes the drawer", () => {
    h.search = "tab=evals";
    h.evalCases = [CASE];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^stripe-key-leak: never run/ }));
    expect(h.push).toHaveBeenCalledWith("/skills/sk1?tab=evals&case=c1");
  });

  it("closing the drawer replaces the URL without case and suite", () => {
    h.search = "tab=evals&case=c1&suite=s1";
    h.evalCases = [CASE];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
  });

  it("a ?case= for a case the skill does not have is dropped from the URL", () => {
    h.search = "tab=evals&case=ghost";
    h.evalCases = [CASE];
    renderView();
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
  });
});
