/**
 * TransformToSkillModal — the payload it sends (AC-43), the guard on closing
 * with edits (AC-46), the inline errors (AC-47), the size-vs-budget readout
 * (AC-44) and the success panel (AC-48). The data hooks are faked; the body
 * builder, budget maths and every child component run for real.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import type { Agent, AgentSkillLink, CreateSkillFromConventionsResponse, SkillListItem } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../messages/en/conventions.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { candidate } from "../../fixtures";

const h = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  agents: [] as Agent[],
  skills: [] as SkillListItem[],
  linksByAgent: {} as Record<string, AgentSkillLink[]>,
  linksPending: false,
  onClose: vi.fn(),
  onCreated: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useCreateSkillFromConventions: () => ({ mutateAsync: h.mutateAsync, isPending: h.isPending }),
  useAgents: () => ({ data: h.agents }),
  useSkills: () => ({ data: h.skills }),
  useAgentsSkillLinks: (ids: readonly string[]) => ({
    byAgent: new Map(ids.filter((id) => h.linksByAgent[id]).map((id) => [id, h.linksByAgent[id]!])),
    isPending: h.linksPending,
  }),
}));

import { TransformToSkillModal } from "./TransformToSkillModal";

const CONVENTIONS = [
  candidate("c1", { status: "accepted", rule: "Always use async/await instead of .then() chains" }),
  candidate("c2", {
    status: "accepted",
    rule: "Redis access goes through the shared singleton",
    evidence: [{ path: "src/lib/redis.ts", line_start: 1, line_end: 9, snippet: "export const redis = new Redis(config.redisUrl);" }],
  }),
];

const agent = (id: string, name: string): Agent => ({
  id,
  name,
  description: "",
  provider: "openai",
  model: "gpt-x",
  system_prompt: "p",
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
});

function skillWithBody(id: string, bytes: number): SkillListItem {
  return {
    id,
    name: id,
    description: "",
    type: "custom",
    source: "manual",
    body: "a".repeat(bytes),
    enabled: true,
    version: 1,
    needs_vetting: false,
    agent_count: 1,
  };
}

function response(over: Partial<CreateSkillFromConventionsResponse> = {}): CreateSkillFromConventionsResponse {
  return {
    skill: { ...skillWithBody("sk-new", 10), name: "payments-api-conventions", needs_vetting: false },
    linked_agent_ids: [],
    ...over,
  };
}

beforeEach(() => {
  h.mutateAsync.mockReset().mockResolvedValue(response());
  h.isPending = false;
  h.agents = [agent("ag1", "Perf Reviewer"), agent("ag2", "Security Reviewer")];
  h.skills = [];
  h.linksByAgent = {};
  h.linksPending = false;
  h.onClose.mockReset();
  h.onCreated.mockReset();
});
afterEach(cleanup);

function renderModal() {
  return renderWithProviders(
    <TransformToSkillModal
      repoId="repo-1"
      repoName="payments-api"
      conventions={CONVENTIONS}
      onClose={h.onClose}
      onCreated={h.onCreated}
    />,
    { namespaces: { conventions: messages, shell: shellMessages } },
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Create skill from conventions" });
const nameInput = () => screen.getByRole("textbox", { name: /^Name/ });
const bodyInput = () => screen.getByRole("textbox", { name: "Skill body" });
const createBtn = () => within(dialog()).getByRole("button", { name: "Create skill" });

async function attach(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("defaults (AC-43)", () => {
  it("opens with a slug name, a description, a fixed Type and Enabled on", () => {
    renderModal();
    expect(nameInput()).toHaveValue("payments-api-conventions");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("2 house conventions extracted from payments-api");
    expect(screen.getByRole("combobox", { name: "Type" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("convention");
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Merged from/)).toHaveTextContent("Merged from 2 accepted conventions in payments-api");
  });

  it("builds the body with the preamble and each rule's evidence", () => {
    renderModal();
    const body = (bodyInput() as HTMLTextAreaElement).value;
    expect(body.startsWith("# payments-api-conventions\n\nHouse conventions for `payments-api`.")).toBe(true);
    expect(body).toContain("cite the offending `file:line`");
    expect(body).toContain("Detected in `src/api/users.ts:23-31`");
    expect(body).toContain("Detected in `src/lib/redis.ts:1-9`");
  });

  it("shows an estimated token count and the body size in bytes", () => {
    renderModal();
    expect(screen.getByText(/^≈\d+ tokens · [\d.]+ (B|KB)$/)).toBeInTheDocument();
    expect(screen.getByText(/^This body: /)).toBeInTheDocument();
  });
});

describe("name drives the body heading and the default", () => {
  const firstLine = () => (bodyInput() as HTMLTextAreaElement).value.split("\n")[0];

  it("rewrites the whole derived body when Name changes and the body is untouched", () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: "team-rules" } });
    expect(firstLine()).toBe("# team-rules");
    expect((bodyInput() as HTMLTextAreaElement).value).toContain("House conventions for `payments-api`.");
  });

  it("updates only the H1 of an edited body when it still matches the previous name", () => {
    renderModal();
    const edited = (bodyInput() as HTMLTextAreaElement).value.replace("House conventions", "My own intro");
    fireEvent.change(bodyInput(), { target: { value: edited } });
    fireEvent.change(nameInput(), { target: { value: "team-rules" } });
    expect((bodyInput() as HTMLTextAreaElement).value).toBe(edited.replace("# payments-api-conventions", "# team-rules"));
  });

  it("leaves an edited body alone when its first line is no longer the old H1", () => {
    renderModal();
    fireEvent.change(bodyInput(), { target: { value: "# Custom title\n\ntext" } });
    fireEvent.change(nameInput(), { target: { value: "team-rules" } });
    expect((bodyInput() as HTMLTextAreaElement).value).toBe("# Custom title\n\ntext");
  });

  it("defaults to the first free name when the base is taken", () => {
    h.skills = [skillWithBody("payments-api-conventions", 1), skillWithBody("payments-api-conventions-2", 1)];
    renderModal();
    expect(nameInput()).toHaveValue("payments-api-conventions-3");
    expect(firstLine()).toBe("# payments-api-conventions-3");
  });
});

describe("creating (AC-6, AC-48)", () => {
  it("sends the edited fields, the selected convention ids and the attached agents", async () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: "house-rules" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "  Team rules  " } });
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.change(bodyInput(), { target: { value: "# house-rules\n\nBe kind.\n" } });
    await attach("Perf Reviewer");
    fireEvent.click(createBtn());

    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.mutateAsync).toHaveBeenCalledWith({
      name: "house-rules",
      description: "Team rules",
      body: "# house-rules\n\nBe kind.\n",
      enabled: false,
      convention_ids: ["c1", "c2"],
      agent_ids: ["ag1"],
    });
  });

  it("omits an empty description", async () => {
    renderModal();
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "  " } });
    fireEvent.click(createBtn());
    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalled());
    expect(h.mutateAsync.mock.calls[0]?.[0].description).toBeUndefined();
  });

  it("replaces the form with a success panel that stays until dismissed", async () => {
    h.mutateAsync.mockResolvedValue(response({ linked_agent_ids: ["ag1", "ag2"] }));
    renderModal();
    await attach("Perf Reviewer");
    await attach("Security Reviewer");
    fireEvent.click(createBtn());

    expect(await screen.findByText("Skill created")).toBeInTheDocument();
    expect(h.onCreated).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open skill" })).toHaveAttribute("href", "/skills/sk-new?tab=config");
    expect(screen.getByRole("link", { name: "Open Perf Reviewer Skills tab" })).toHaveAttribute("href", "/agents/ag1?tab=skills");
    expect(screen.getByRole("link", { name: "Open Security Reviewer Skills tab" })).toHaveAttribute("href", "/agents/ag2?tab=skills");
    expect(screen.queryByRole("textbox", { name: "Skill body" })).not.toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled(); // no auto-dismiss

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes a saved skill on Escape without a discard prompt", async () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: "house-rules" } });
    fireEvent.click(createBtn());
    await screen.findByText("Skill created");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard this skill?")).not.toBeInTheDocument();
  });
});

describe("attach to agents (AC-45)", () => {
  it("adds an agent as a removable chip and stops offering it", async () => {
    renderModal();
    await attach("Perf Reviewer");
    expect(screen.getByRole("button", { name: "Remove Perf Reviewer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    expect(screen.queryByRole("option", { name: "Perf Reviewer" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Security Reviewer" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Add agent" }), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Perf Reviewer" }));
    expect(screen.getByText("No agents attached.")).toBeInTheDocument();
  });

  it("filters the agent list by the search text", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Add agent" }), { target: { value: "secur" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Security Reviewer"]);
  });
});

describe("validation and inline errors (AC-47)", () => {
  it("blocks Create and explains a name that breaks the slug rule", () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: "Not A Slug" } });
    expect(createBtn()).toBeDisabled();
    expect(screen.getByText(/Use lowercase letters, digits and hyphens/)).toBeInTheDocument();
    fireEvent.change(nameInput(), { target: { value: "fine-name" } });
    expect(createBtn()).toBeEnabled();
  });

  it("shows a taken name next to the Name field and keeps the form", async () => {
    h.mutateAsync.mockRejectedValue(new ApiError("exists", 409, "skill_name_taken"));
    renderModal();
    fireEvent.click(createBtn());
    expect(await screen.findByText('A skill named "payments-api-conventions" already exists. Pick another name.')).toBeInTheDocument();
    expect(screen.queryByText("Skill created")).not.toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(h.onCreated).not.toHaveBeenCalled();

    fireEvent.change(nameInput(), { target: { value: "another-name" } });
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });

  it("names the agent when the server reports a budget overrun", async () => {
    h.mutateAsync.mockRejectedValue(new ApiError("over", 422, "agent_skills_budget_exceeded", { agent_id: "ag2" }));
    renderModal();
    fireEvent.click(createBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Attaching would push Security Reviewer over its 24 KB skills budget");
  });

  it("explains a convention that is no longer accepted", async () => {
    h.mutateAsync.mockRejectedValue(new ApiError("nope", 422, "convention_not_accepted"));
    renderModal();
    fireEvent.click(createBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer accepted");
  });

  it("falls back to the server's message for anything else", async () => {
    h.mutateAsync.mockRejectedValue(new ApiError("Body has invisible characters", 422, "hygiene"));
    renderModal();
    fireEvent.click(createBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Body has invisible characters");
  });
});

describe("dirty confirm (AC-46)", () => {
  it("closes at once when nothing was edited", () => {
    renderModal();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before closing edits from Cancel, Escape and the close button", () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: "edited-name" } });

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard this skill?" })).toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard this skill?" })).not.toBeInTheDocument();
    expect(nameInput()).toHaveValue("edited-name"); // the edit survived

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Discard this skill?" })).toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("closes only after the person confirms the discard", () => {
    renderModal();
    fireEvent.change(bodyInput(), { target: { value: "edited body text" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("counts an attached agent as an edit", async () => {
    renderModal();
    await attach("Perf Reviewer");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard this skill?" })).toBeInTheDocument();
  });

  it("does not treat a reverted edit as dirty", () => {
    renderModal();
    fireEvent.change(nameInput(), { target: { value: "temp-name" } });
    fireEvent.change(nameInput(), { target: { value: "payments-api-conventions" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("raw view (AC-44)", () => {
  it("marks invisible characters and warns about them", () => {
    renderModal();
    fireEvent.change(bodyInput(), { target: { value: "# x\n\nhidden​char <!-- note -->" } });
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.getByText("[U+200B]")).toBeInTheDocument();
    expect(screen.getByText(/invisible or bidirectional characters/)).toBeInTheDocument();
    expect(screen.getByText(/HTML comments/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(bodyInput()).toBeInTheDocument();
  });

  it("shows a clean body without warnings", () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.queryByText(/invisible or bidirectional/)).not.toBeInTheDocument();
    expect(screen.queryByText("[U+200B]")).not.toBeInTheDocument();
  });
});

describe("budget vs the remaining 24 KB (AC-44, V15)", () => {
  it("shows what each attached agent has left", async () => {
    h.skills = [skillWithBody("s1", 20000)];
    h.linksByAgent = { ag1: [{ agent_id: "ag1", skill_id: "s1", order: 0, enabled: true }], ag2: [] };
    renderModal();
    await attach("Perf Reviewer");
    await attach("Security Reviewer");
    expect(screen.getByText("Perf Reviewer: 4.5 KB left")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer: 24.0 KB left")).toBeInTheDocument();
    expect(createBtn()).toBeEnabled();
  });

  it("blocks Create when the body does not fit an attached agent, and Enabled off unblocks it", async () => {
    h.skills = [skillWithBody("s1", 24000)];
    h.linksByAgent = { ag1: [{ agent_id: "ag1", skill_id: "s1", order: 0, enabled: true }] };
    renderModal();
    fireEvent.change(bodyInput(), { target: { value: "x".repeat(1000) } });
    await attach("Perf Reviewer");
    expect(screen.getByText(/Perf Reviewer: over budget/)).toBeInTheDocument();
    expect(createBtn()).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(screen.getByText(/Perf Reviewer: 576 B left/)).toBeInTheDocument();
    expect(createBtn()).toBeEnabled(); // a disabled skill never reaches a prompt
  });

  it("does not count a disabled skill or a disabled link against the agent", async () => {
    h.skills = [{ ...skillWithBody("s1", 24000), enabled: false }, skillWithBody("s2", 24000)];
    h.linksByAgent = {
      ag1: [
        { agent_id: "ag1", skill_id: "s1", order: 0, enabled: true },
        { agent_id: "ag1", skill_id: "s2", order: 1, enabled: false },
      ],
    };
    renderModal();
    await attach("Perf Reviewer");
    expect(screen.getByText("Perf Reviewer: 24.0 KB left")).toBeInTheDocument();
  });

  it("says so while the agents' skills are still loading", async () => {
    h.linksPending = true;
    renderModal();
    await attach("Perf Reviewer");
    expect(screen.getByText("Reading the agents' current skills…")).toBeInTheDocument();
    expect(createBtn()).toBeEnabled(); // unknown is not a block; the server still enforces the limit
  });

  it("falls back to the size and the limit when an agent's links could not be read", async () => {
    // pending false, but no links for the agent: the remaining budget is unknown.
    renderModal();
    await attach("Perf Reviewer");
    expect(screen.getByText("Remaining budget of the selected agents is not available.")).toBeInTheDocument();
    expect(screen.getByText(/^This body: /)).toBeInTheDocument();
    expect(screen.getByText("Skills budget (24 KB per agent)")).toBeInTheDocument();
  });
});
