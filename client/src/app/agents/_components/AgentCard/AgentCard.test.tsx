import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Agent } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../messages/en/agents.json";

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  useDeleteAgent: () => ({ mutate: mutateMock, isPending: false }),
}));

import { AgentCard } from "./AgentCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => mutateMock.mockReset());

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const renderCard = (ui: React.ReactElement) => renderWithProviders(ui, { namespaces: { agents: messages } });

describe("AgentCard", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderCard(<AgentCard ag={AGENT} skillCount={3} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderCard(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("opens the agent through a focusable link named after it", () => {
    renderCard(<AgentCard ag={AGENT} href="/agents/ag1?tab=config" />);
    const link = screen.getByRole("link", { name: "Security Reviewer" });
    expect(link).toHaveAttribute("href", "/agents/ag1?tab=config");
    link.focus();
    expect(link).toHaveFocus();
  });

  it("marks the active card as the current page", () => {
    renderCard(<AgentCard ag={AGENT} href="/agents/ag1" active />);
    expect(screen.getByRole("link", { name: "Security Reviewer" })).toHaveAttribute("aria-current", "page");
  });

  it("renders no link when it has nowhere to go", () => {
    renderCard(<AgentCard ag={AGENT} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the toggle and delete action outside the link", () => {
    const onToggle = vi.fn();
    renderCard(<AgentCard ag={AGENT} href="/agents/ag1" onToggle={onToggle} />);
    const link = screen.getByRole("link", { name: "Security Reviewer" });
    expect(within(link).queryByRole("button")).not.toBeInTheDocument();
    expect(within(link).queryByRole("switch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Enable Security Reviewer" }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("deletes only after the translated confirm is accepted", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderCard(<AgentCard ag={AGENT} href="/agents/ag1" />);
    const del = screen.getByRole("button", { name: "Delete agent" });

    fireEvent.click(del);
    expect(confirm).toHaveBeenCalledWith('Delete agent "Security Reviewer"? This cannot be undone.');
    expect(mutateMock).not.toHaveBeenCalled();

    fireEvent.click(del);
    expect(mutateMock).toHaveBeenCalledWith("ag1");
  });
});
