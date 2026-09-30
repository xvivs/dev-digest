/**
 * SkillEditorView — what the SCREEN decides: which tab ?tab= resolves to,
 * where tab changes and skill cards point, the error branch, and the AC-8
 * dirty-form navigation guard end to end (Config tab dirty → card click
 * asks first). ConfigTab/PreviewTab have their own suites. AppShell renders
 * for real (no `@/lib/repo-context` mock: with no `<RepoProvider>` in the
 * tree it falls back to its context's empty default — no repo, no crash).
 * The real data hooks run; only the transport (`api`) and `next/navigation`
 * are faked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill, SkillEvalCase } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../messages/en/skills.json";
import shellMessages from "../../../../../../messages/en/shell.json";
import common from "../../../../../../messages/en/common.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import costMessages from "../../../../../../messages/en/cost.json";

type Schema = { parse: (v: unknown) => unknown };
const h = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: h.push }),
  useSearchParams: () => new URLSearchParams(h.search),
  usePathname: () => "/skills/sk1",
}));

// Only the transport is faked: the real hooks run, and every response is parsed
// through the schema the hook hands over (ADR 0007), so fixtures must satisfy the contract.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: h.get, post: h.post, put: h.put, del: h.del } };
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

const CASE: SkillEvalCase = {
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

interface World {
  skill: Skill | ApiError;
  skills: unknown[];
  evalCases: SkillEvalCase[];
}
let world: World;

const answer = (value: unknown, schema?: Schema) => Promise.resolve(schema ? schema.parse(value) : value);

function routeGet(path: string, schema?: Schema) {
  if (path === "/skills") return answer(world.skills, schema);
  if (path === "/skills/sk1") return world.skill instanceof ApiError ? Promise.reject(world.skill) : answer(world.skill, schema);
  if (path === "/skills/sk1/versions") return answer([], schema);
  if (path.startsWith("/skills/sk1/stats?window=")) {
    const window = path.split("=")[1];
    return answer(
      {
        skill_id: "sk1",
        window,
        usage: { runs: 0, agents: [] },
        cost: { tokens: 0, cost_usd: null, cost_source: null },
        by_version: [],
        impact: null,
      },
      schema,
    );
  }
  if (path === "/skills/sk1/eval-cases") return answer(world.evalCases, schema);
  if (path === "/skills/sk1/eval-cases/latest-results") return answer([], schema);
  if (path === "/skills/sk1/eval-suites") return answer([], schema);
  if (path === "/skills/sk1/eval-carriers") return answer([], schema);
  if (path === "/agents") return answer([], schema);
  // The drawer's case detail never settles: only the drawer's presence is asserted here.
  if (path.startsWith("/eval-cases/")) return new Promise(() => {});
  return Promise.reject(new ApiError(`unexpected GET ${path}`, 404));
}

beforeEach(() => {
  h.replace.mockReset();
  h.push.mockReset();
  h.search = "";
  world = {
    skill: SKILL,
    skills: [
      { ...SKILL, agent_count: 1 },
      { ...OTHER, agent_count: 0 },
    ],
    evalCases: [],
  };
  h.get.mockReset().mockImplementation(routeGet);
  h.post.mockReset();
  h.put.mockReset();
  h.del.mockReset();
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

/** Wait for the skill to load, then type into the Config body so the form is dirty. */
async function makeDirty(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByDisplayValue("# Rule"), " v2");
}

describe("SkillEditorView", () => {
  it("renders the selected skill's editor", async () => {
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: "branch-coverage-gate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
  });

  it("falls back to the config tab for an unknown ?tab=", async () => {
    h.search = "tab=bogus";
    renderView();
    expect(await screen.findByRole("link", { name: "route-signature-diff" })).toHaveAttribute(
      "href",
      "/skills/sk2?tab=config",
    );
  });

  it("marks the open skill's card as current", async () => {
    renderView();
    expect(await screen.findByRole("link", { name: "branch-coverage-gate" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "route-signature-diff" })).not.toHaveAttribute("aria-current");
  });

  it("writes a tab change to the URL when the form is clean", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("tab", { name: "Preview" }));
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview");
  });

  it("shows the translated error with the API message when the skill fails to load", async () => {
    world.skill = new ApiError("Skill not found", 404);
    renderView();
    expect(await screen.findByText("Could not load this skill.")).toBeInTheDocument();
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
  });

  it("asks for confirmation before a tab switch when the Config tab is dirty (AC-8)", async () => {
    const user = userEvent.setup();
    renderView();
    await makeDirty(user);
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("cancelling the guard keeps the tab switch from happening", async () => {
    const user = userEvent.setup();
    renderView();
    await makeDirty(user);
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("confirming the guard proceeds with the tab switch", async () => {
    const user = userEvent.setup();
    renderView();
    await makeDirty(user);
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview");
  });

  it("asks for confirmation before opening another skill's card while dirty", async () => {
    const user = userEvent.setup();
    renderView();
    await makeDirty(user);
    // The link is left to itself (see SkillCard); the mouse-only card body is
    // what pushes programmatically, so click its non-interactive content.
    await user.click(await screen.findByText("Flags breaking route changes."));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  describe("header Run on evals", () => {
    it("switches to the Evals tab from another tab", async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(await screen.findByRole("button", { name: "Run on evals" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
    });

    it("on the Evals tab, opens the Run modal", async () => {
      const user = userEvent.setup();
      h.search = "tab=evals";
      renderView();
      await user.click(await screen.findByRole("button", { name: "Run on evals" }));
      expect(await screen.findByRole("dialog", { name: "Run on evals" })).toBeInTheDocument();
      expect(h.replace).not.toHaveBeenCalled();
    });

    it("asks before leaving a dirty Config", async () => {
      const user = userEvent.setup();
      renderView();
      await makeDirty(user);
      await user.click(screen.getByRole("button", { name: "Run on evals" }));
      expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
      expect(h.replace).not.toHaveBeenCalled();
    });
  });

  describe("Stats window (?window=)", () => {
    const statsCalls = () => h.get.mock.calls.map(([path]) => path as string).filter((p) => p.startsWith("/skills/sk1/stats"));

    it("reads the window from the URL and defaults to 30d", async () => {
      h.search = "tab=stats";
      renderView();
      await waitFor(() => expect(statsCalls()).toContain("/skills/sk1/stats?window=30d"));
      expect(statsCalls()).not.toContain("/skills/sk1/stats?window=90d");
      cleanup();
      h.get.mockClear();
      h.search = "tab=stats&window=90d";
      renderView();
      await waitFor(() => expect(statsCalls()).toContain("/skills/sk1/stats?window=90d"));
      expect(statsCalls()).not.toContain("/skills/sk1/stats?window=30d");
      expect(await screen.findByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
    });

    it("writes a window change to the URL, keeping the tab", async () => {
      const user = userEvent.setup();
      h.search = "tab=stats";
      renderView();
      await user.click(await screen.findByRole("button", { name: "7d" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=stats&window=7d");
    });

    it("keeps the window across a tab switch", async () => {
      const user = userEvent.setup();
      h.search = "tab=stats&window=7d";
      renderView();
      await user.click(await screen.findByRole("tab", { name: "Preview" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview&window=7d");
    });

    it("the Impact CTA opens the Evals tab", async () => {
      const user = userEvent.setup();
      h.search = "tab=stats";
      renderView();
      await user.click(await screen.findByRole("button", { name: "Run evals" }));
      expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
    });
  });
});

describe("SkillEditorView — eval case drawer (?case=)", () => {
  it("?tab=evals&case=<id> opens the drawer on load", async () => {
    h.search = "tab=evals&case=c1";
    world.evalCases = [CASE];
    renderView();
    expect(await screen.findByRole("dialog", { name: "Eval case details" })).toBeInTheDocument();
  });

  it("?case= is ignored outside the Evals tab", async () => {
    h.search = "tab=config&case=c1";
    world.evalCases = [CASE];
    renderView();
    await screen.findByRole("heading", { name: "Configuration" });
    expect(screen.queryByRole("dialog", { name: "Eval case details" })).not.toBeInTheDocument();
  });

  it("opening a card pushes ?case= so Back closes the drawer", async () => {
    const user = userEvent.setup();
    h.search = "tab=evals";
    world.evalCases = [CASE];
    renderView();
    await user.click(await screen.findByRole("button", { name: /^stripe-key-leak: never run/ }));
    expect(h.push).toHaveBeenCalledWith("/skills/sk1?tab=evals&case=c1");
  });

  it("closing the drawer replaces the URL without case and suite", async () => {
    const user = userEvent.setup();
    h.search = "tab=evals&case=c1&suite=s1";
    world.evalCases = [CASE];
    renderView();
    await user.click(await screen.findByRole("button", { name: "Close" }));
    expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals");
  });

  it("a ?case= for a case the skill does not have is dropped from the URL", async () => {
    h.search = "tab=evals&case=ghost";
    world.evalCases = [CASE];
    renderView();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/skills/sk1?tab=evals"));
  });
});
