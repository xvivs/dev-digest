/**
 * TransformToSkillModal — the payload it sends (AC-43), the guard on closing
 * with edits (AC-46), the inline errors (AC-47), the size-vs-budget readout
 * (AC-44) and the success panel (AC-48). Only the network is faked (`fetch`,
 * see `@/test/fake-api`): the real hooks, query cache, body builder, budget
 * maths and every child component run. `onClose` / `onCreated` are the
 * modal's own props, so they are plain spies.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, AgentSkillLink, SkillListItem } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { apiError, json, setupFakeApi } from "@/test/fake-api";
import messages from "../../../../../../../messages/en/conventions.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { candidate, createdSkill } from "../../fixtures";
import { TransformToSkillModal } from "./TransformToSkillModal";

const api = setupFakeApi();

const h = vi.hoisted(() => ({ onClose: vi.fn(), onCreated: vi.fn() }));

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

function deferred() {
  let resolve: (r: Response) => void = () => {};
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** What the fake server holds: the workspace's skills, its agents and each agent's skill links. */
const server = {
  skills: [] as SkillListItem[],
  agents: [] as Agent[],
  links: {} as Record<string, AgentSkillLink[]>,
};

beforeEach(() => {
  h.onClose.mockReset();
  h.onCreated.mockReset();
  server.skills = [];
  server.agents = [agent("ag1", "Perf Reviewer"), agent("ag2", "Security Reviewer")];
  server.links = {};
  api.route("GET", "/skills", () => json(server.skills));
  api.route("GET", "/agents", () => json(server.agents));
  api.route("GET", "/agents/:id/skills", ({ params }) => json(server.links[params.id ?? ""] ?? []));
  api.route("POST", "/repos/repo-1/conventions/skills", () => json(createdSkill(), 201));
});
afterEach(cleanup);

function renderModal() {
  const user = userEvent.setup();
  renderWithProviders(
    <TransformToSkillModal
      repoId="repo-1"
      repoName="payments-api"
      conventions={CONVENTIONS}
      onClose={h.onClose}
      onCreated={h.onCreated}
    />,
    { namespaces: { conventions: messages, shell: shellMessages } },
  );
  return user;
}

type User = ReturnType<typeof userEvent.setup>;

const dialog = () => screen.getByRole("dialog", { name: "Create skill from conventions" });
const nameInput = () => screen.getByRole("textbox", { name: /^Name/ });
const descriptionInput = () => screen.getByRole("textbox", { name: "Description" });
const bodyInput = () => screen.getByRole("textbox", { name: "Skill body" }) as HTMLTextAreaElement;
const createBtn = () => within(dialog()).getByRole("button", { name: "Create skill" });
const createRequests = () => api.requestsTo("POST", "/repos/repo-1/conventions/skills");

/** Replaces the whole value of a text field, the way a paste over a select-all would. */
async function replaceText(user: User, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.paste(text);
}

/** The picker renders once the agent list has loaded, hence the `find`. */
async function attach(user: User, name: string) {
  await user.click(await screen.findByRole("button", { name: "Add agent" }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("defaults (AC-43)", () => {
  it("opens with a slug name, a description, a fixed Type and Enabled on", () => {
    renderModal();
    expect(nameInput()).toHaveValue("payments-api-conventions");
    expect(descriptionInput()).toHaveValue("2 house conventions extracted from payments-api");
    expect(screen.getByRole("combobox", { name: "Type" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("convention");
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Merged from/)).toHaveTextContent("Merged from 2 accepted conventions in payments-api");
  });

  it("builds the body with the preamble and each rule's evidence", () => {
    renderModal();
    const body = bodyInput().value;
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
  const firstLine = () => bodyInput().value.split("\n")[0];

  it("rewrites the whole derived body when Name changes and the body is untouched", async () => {
    const user = renderModal();
    await replaceText(user, nameInput(), "team-rules");
    expect(firstLine()).toBe("# team-rules");
    expect(bodyInput().value).toContain("House conventions for `payments-api`.");
  });

  it("updates only the H1 of an edited body when it still matches the previous name", async () => {
    const user = renderModal();
    const edited = bodyInput().value.replace("House conventions", "My own intro");
    await replaceText(user, bodyInput(), edited);
    await replaceText(user, nameInput(), "team-rules");
    expect(bodyInput().value).toBe(edited.replace("# payments-api-conventions", "# team-rules"));
  });

  it("leaves an edited body alone when its first line is no longer the old H1", async () => {
    const user = renderModal();
    await replaceText(user, bodyInput(), "# Custom title\n\ntext");
    await replaceText(user, nameInput(), "team-rules");
    expect(bodyInput().value).toBe("# Custom title\n\ntext");
  });

  it("defaults to the first free name when the base is taken", async () => {
    server.skills = [skillWithBody("payments-api-conventions", 1), skillWithBody("payments-api-conventions-2", 1)];
    renderModal();
    expect(await screen.findByDisplayValue("payments-api-conventions-3")).toBe(nameInput());
    expect(firstLine()).toBe("# payments-api-conventions-3");
  });

  it("carries an edited body's H1 to the default name when the skill list arrives late (Name untouched)", async () => {
    const skills = deferred();
    api.route("GET", "/skills", () => skills.promise);
    const user = renderModal();
    const edited = bodyInput().value.replace("House conventions", "My own intro");
    await replaceText(user, bodyInput(), edited);
    expect(nameInput()).toHaveValue("payments-api-conventions");

    // The workspace already has that name: the default moves to `-2` after the body was edited.
    skills.resolve(json([skillWithBody("payments-api-conventions", 1)]));
    await waitFor(() => expect(nameInput()).toHaveValue("payments-api-conventions-2"));
    const carried = edited.replace("# payments-api-conventions\n", "# payments-api-conventions-2\n");
    expect(bodyInput().value).toBe(carried);

    // What is saved is the body the person sees: the heading and the name agree.
    await user.click(createBtn());
    await waitFor(() => expect(createRequests()).toHaveLength(1));
    expect(createRequests()[0]?.body).toMatchObject({ name: "payments-api-conventions-2", body: carried });
  });

  it("does not touch a typed Name when the skill list arrives late", async () => {
    const skills = deferred();
    api.route("GET", "/skills", () => skills.promise);
    const user = renderModal();
    await replaceText(user, nameInput(), "team-rules");
    skills.resolve(json([skillWithBody("payments-api-conventions", 1)]));
    await waitFor(() => expect(api.requestsTo("GET", "/skills")).toHaveLength(1));
    await screen.findByRole("button", { name: "Add agent" });
    expect(nameInput()).toHaveValue("team-rules");
    expect(bodyInput().value.split("\n")[0]).toBe("# team-rules");
  });
});

describe("creating (AC-6, AC-48)", () => {
  it("sends the edited fields, the selected convention ids and the attached agents", async () => {
    const user = renderModal();
    await replaceText(user, nameInput(), "house-rules");
    await replaceText(user, descriptionInput(), "  Team rules  ");
    await user.click(screen.getByRole("switch", { name: "Enabled" }));
    await replaceText(user, bodyInput(), "# house-rules\n\nBe kind.\n");
    await attach(user, "Perf Reviewer");
    await user.click(createBtn());

    await waitFor(() => expect(createRequests()).toHaveLength(1));
    expect(createRequests()[0]?.body).toEqual({
      name: "house-rules",
      description: "Team rules",
      body: "# house-rules\n\nBe kind.\n",
      enabled: false,
      convention_ids: ["c1", "c2"],
      agent_ids: ["ag1"],
    });
  });

  it("omits an empty description", async () => {
    const user = renderModal();
    await replaceText(user, descriptionInput(), "  ");
    await user.click(createBtn());
    await waitFor(() => expect(createRequests()).toHaveLength(1));
    expect(createRequests()[0]?.body).not.toHaveProperty("description");
  });

  it("replaces the form with a success panel that stays until dismissed", async () => {
    api.route("POST", "/repos/repo-1/conventions/skills", () => json(createdSkill({ linked_agent_ids: ["ag1", "ag2"] }), 201));
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    await attach(user, "Security Reviewer");
    await user.click(createBtn());

    expect(await screen.findByText("Skill created")).toBeInTheDocument();
    expect(h.onCreated).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open skill" })).toHaveAttribute("href", "/skills/sk-new?tab=config");
    expect(screen.getByRole("link", { name: "Open Perf Reviewer Skills tab" })).toHaveAttribute("href", "/agents/ag1?tab=skills");
    expect(screen.getByRole("link", { name: "Open Security Reviewer Skills tab" })).toHaveAttribute("href", "/agents/ag2?tab=skills");
    expect(screen.queryByRole("textbox", { name: "Skill body" })).not.toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled(); // no auto-dismiss

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes a saved skill on Escape without a discard prompt", async () => {
    const user = renderModal();
    await replaceText(user, nameInput(), "house-rules");
    await user.click(createBtn());
    await screen.findByText("Skill created");
    await user.keyboard("{Escape}");
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard this skill?")).not.toBeInTheDocument();
  });
});

describe("attach to agents (AC-45)", () => {
  it("adds an agent as a removable chip and stops offering it", async () => {
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    expect(screen.getByRole("button", { name: "Remove Perf Reviewer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent" }));
    expect(screen.queryByRole("option", { name: "Perf Reviewer" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Security Reviewer" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Remove Perf Reviewer" }));
    expect(screen.getByText("No agents attached.")).toBeInTheDocument();
  });

  it("filters the agent list by the search text", async () => {
    const user = renderModal();
    await user.click(await screen.findByRole("button", { name: "Add agent" }));
    await user.type(screen.getByRole("combobox", { name: "Add agent" }), "secur");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Security Reviewer"]);
  });
});

describe("validation and inline errors (AC-47)", () => {
  it("blocks Create and explains a name that breaks the slug rule", async () => {
    const user = renderModal();
    await replaceText(user, nameInput(), "Not A Slug");
    expect(createBtn()).toBeDisabled();
    expect(screen.getByText(/Use lowercase letters, digits and hyphens/)).toBeInTheDocument();
    await replaceText(user, nameInput(), "fine-name");
    expect(createBtn()).toBeEnabled();
  });

  it("shows a taken name next to the Name field and keeps the form", async () => {
    api.route("POST", "/repos/repo-1/conventions/skills", () => apiError(409, "skill_name_taken", "exists"));
    const user = renderModal();
    await user.click(createBtn());
    expect(await screen.findByText('A skill named "payments-api-conventions" already exists. Pick another name.')).toBeInTheDocument();
    expect(screen.queryByText("Skill created")).not.toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(h.onCreated).not.toHaveBeenCalled();

    await replaceText(user, nameInput(), "another-name");
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });

  it("names the agent when the server reports a budget overrun", async () => {
    api.route("POST", "/repos/repo-1/conventions/skills", () =>
      apiError(422, "agent_skills_budget_exceeded", "over", { agent_id: "ag2" }),
    );
    const user = renderModal();
    await user.click(createBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Attaching would push Security Reviewer over its 24 KB skills budget");
  });

  it("explains a convention that is no longer accepted", async () => {
    api.route("POST", "/repos/repo-1/conventions/skills", () => apiError(422, "convention_not_accepted", "nope"));
    const user = renderModal();
    await user.click(createBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer accepted");
  });

  it("falls back to the server's message for anything else", async () => {
    api.route("POST", "/repos/repo-1/conventions/skills", () => apiError(422, "hygiene", "Body has invisible characters"));
    const user = renderModal();
    await user.click(createBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Body has invisible characters");
  });
});

describe("dirty confirm (AC-46)", () => {
  it("closes at once when nothing was edited", async () => {
    const user = renderModal();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before closing edits from Cancel and Escape", async () => {
    const user = renderModal();
    await replaceText(user, nameInput(), "edited-name");

    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard this skill?" })).toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard this skill?" })).not.toBeInTheDocument();
    expect(nameInput()).toHaveValue("edited-name"); // the edit survived

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Discard this skill?" })).toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("closes only after the person confirms the discard", async () => {
    const user = renderModal();
    await replaceText(user, bodyInput(), "edited body text");
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("counts an attached agent as an edit", async () => {
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard this skill?" })).toBeInTheDocument();
  });

  it("does not treat a reverted edit as dirty", async () => {
    const user = renderModal();
    await replaceText(user, nameInput(), "temp-name");
    await replaceText(user, nameInput(), "payments-api-conventions");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("raw view (AC-44)", () => {
  it("marks invisible characters and warns about them", async () => {
    const user = renderModal();
    await replaceText(user, bodyInput(), "# x\n\nhidden​char <!-- note -->");
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.getByText("[U+200B]")).toBeInTheDocument();
    expect(screen.getByText(/invisible or bidirectional characters/)).toBeInTheDocument();
    expect(screen.getByText(/HTML comments/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    expect(bodyInput()).toBeInTheDocument();
  });

  it("shows a clean body without warnings", async () => {
    const user = renderModal();
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.queryByText(/invisible or bidirectional/)).not.toBeInTheDocument();
    expect(screen.queryByText("[U+200B]")).not.toBeInTheDocument();
  });
});

describe("budget vs the remaining 24 KB (AC-44, V15)", () => {
  const link = (agent_id: string, skill_id: string, order: number, enabled = true): AgentSkillLink => ({
    agent_id,
    skill_id,
    order,
    enabled,
  });

  it("shows what each attached agent has left", async () => {
    server.skills = [skillWithBody("s1", 20000)];
    server.links = { ag1: [link("ag1", "s1", 0)], ag2: [] };
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    await attach(user, "Security Reviewer");
    expect(await screen.findByText("Perf Reviewer: 4.5 KB left")).toBeInTheDocument();
    expect(await screen.findByText("Security Reviewer: 24.0 KB left")).toBeInTheDocument();
    expect(createBtn()).toBeEnabled();
  });

  it("blocks Create when the body does not fit an attached agent, and Enabled off unblocks it", async () => {
    server.skills = [skillWithBody("s1", 24000)];
    server.links = { ag1: [link("ag1", "s1", 0)] };
    const user = renderModal();
    await replaceText(user, bodyInput(), "x".repeat(1000));
    await attach(user, "Perf Reviewer");
    expect(await screen.findByText(/Perf Reviewer: over budget/)).toBeInTheDocument();
    expect(createBtn()).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(screen.getByText(/Perf Reviewer: 576 B left/)).toBeInTheDocument();
    expect(createBtn()).toBeEnabled(); // a disabled skill never reaches a prompt
  });

  it("does not count a disabled skill or a disabled link against the agent", async () => {
    server.skills = [{ ...skillWithBody("s1", 24000), enabled: false }, skillWithBody("s2", 24000)];
    server.links = { ag1: [link("ag1", "s1", 0), link("ag1", "s2", 1, false)] };
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    expect(await screen.findByText("Perf Reviewer: 24.0 KB left")).toBeInTheDocument();
  });

  it("says so while the agents' skills are still loading", async () => {
    const links = deferred();
    api.route("GET", "/agents/:id/skills", () => links.promise);
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    expect(await screen.findByText("Reading the agents' current skills…")).toBeInTheDocument();
    expect(createBtn()).toBeEnabled(); // unknown is not a block; the server still enforces the limit
    links.resolve(json([]));
    expect(await screen.findByText("Perf Reviewer: 24.0 KB left")).toBeInTheDocument();
  });

  it("falls back to the size and the limit when an agent's links could not be read", async () => {
    api.route("GET", "/agents/:id/skills", () => apiError(500, "internal", "boom"));
    const user = renderModal();
    await attach(user, "Perf Reviewer");
    expect(await screen.findByText("Remaining budget of the selected agents is not available.")).toBeInTheDocument();
    expect(screen.getByText(/^This body: /)).toBeInTheDocument();
    expect(screen.getByText("Skills budget (24 KB per agent)")).toBeInTheDocument();
  });
});
