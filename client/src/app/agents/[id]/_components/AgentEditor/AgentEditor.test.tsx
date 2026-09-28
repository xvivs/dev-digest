import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { Agent } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import messages from "../../../../../../messages/en/agents.json";
import common from "../../../../../../messages/en/common.json";

// Mock the data hooks so the editor renders without a network.
vi.mock("@/lib/hooks", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

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

const OTHER: Agent = {
  ...AGENT,
  id: "ag2",
  name: "Perf Reviewer",
  description: "Finds slow paths",
  system_prompt: "You are a performance reviewer.",
};

const editor = (agent: Agent) => (
  <ToastProvider>
    <AgentEditor agent={agent} tab="config" onTab={() => {}} />
  </ToastProvider>
);

function renderEditor(agent: Agent) {
  return renderWithProviders(editor(agent), { namespaces: { agents: messages, common } });
}

describe("A2 Agent Editor", () => {
  it("renders the Config tab fields", () => {
    renderEditor(AGENT);
    expect(screen.getByRole("button", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save agent" })).toBeInTheDocument();
  });

  it("shows the new agent's values after switching agents", () => {
    const { rerender } = renderEditor(AGENT);
    expect(screen.getByDisplayValue("Security Reviewer")).toBeInTheDocument();

    rerender(editor(OTHER));

    expect(screen.getByDisplayValue("Perf Reviewer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Finds slow paths")).toBeInTheDocument();
    expect(screen.getByDisplayValue("You are a performance reviewer.")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Security Reviewer")).not.toBeInTheDocument();
  });

  it("discards an unsaved draft when switching agents", () => {
    const { rerender } = renderEditor(AGENT);
    fireEvent.change(screen.getByDisplayValue("Security Reviewer"), { target: { value: "Half-typed name" } });
    expect(screen.getByDisplayValue("Half-typed name")).toBeInTheDocument();

    rerender(editor(OTHER));
    expect(screen.queryByDisplayValue("Half-typed name")).not.toBeInTheDocument();

    rerender(editor(AGENT));
    expect(screen.getByDisplayValue("Security Reviewer")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Half-typed name")).not.toBeInTheDocument();
  });

  it("keeps the draft while the same agent re-renders (e.g. a refetch)", () => {
    const { rerender } = renderEditor(AGENT);
    fireEvent.change(screen.getByDisplayValue("Security Reviewer"), { target: { value: "Renamed" } });

    rerender(editor({ ...AGENT, version: 2 }));

    expect(screen.getByDisplayValue("Renamed")).toBeInTheDocument();
  });
});
