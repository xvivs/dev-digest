/**
 * AgentEditorView — what the SCREEN decides: which tab ?tab= resolves to, where
 * tab changes and agent cards point, and the error branch. AppShell and the
 * data hooks are faked; AgentEditor/ConfigTab have their own suite.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Agent } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../messages/en/agents.json";
import common from "../../../../../../messages/en/common.json";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
  agent: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown, refetch: vi.fn() },
  agents: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: h.push }),
  useSearchParams: () => new URLSearchParams(h.search),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks", () => ({
  useAgents: () => ({ data: h.agents }),
  useAgent: () => h.agent,
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: [] }),
}));

import { AgentEditorView } from "./AgentEditorView";

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
const OTHER: Agent = { ...AGENT, id: "ag2", name: "Perf Reviewer" };

beforeEach(() => {
  h.replace.mockReset();
  h.push.mockReset();
  h.search = "";
  h.agents = [AGENT, OTHER];
  h.agent = { data: AGENT, isLoading: false, isError: false, error: null, refetch: vi.fn() };
});
afterEach(cleanup);

function renderView() {
  return renderWithProviders(
    <ToastProvider>
      <AgentEditorView id="ag1" />
    </ToastProvider>,
    { namespaces: { agents: messages, common } },
  );
}

describe("AgentEditorView", () => {
  it("renders the selected agent's editor", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
  });

  it("falls back to the config tab for an unknown ?tab=", () => {
    h.search = "tab=bogus";
    renderView();
    expect(screen.getByRole("link", { name: "Perf Reviewer" })).toHaveAttribute("href", "/agents/ag2?tab=config");
  });

  it("marks the open agent's card as current", () => {
    renderView();
    expect(screen.getByRole("link", { name: "Security Reviewer" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Perf Reviewer" })).not.toHaveAttribute("aria-current");
  });

  it("writes a tab change to the URL and keeps the other params", () => {
    h.search = "from=pr&tab=config";
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: "Config" }));
    expect(h.replace).toHaveBeenCalledWith("/agents/ag1?from=pr&tab=config");
  });

  it("shows the translated error with the API message when the agent fails to load", () => {
    h.agent = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Agent not found", 404),
      refetch: vi.fn(),
    };
    renderView();
    expect(screen.getByText("Couldn’t load this agent")).toBeInTheDocument();
    expect(screen.getByText("Agent not found")).toBeInTheDocument();
  });

  it("uses the generic body for a non-API error", () => {
    h.agent = { data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn() };
    renderView();
    expect(screen.getByText("The agent could not be loaded.")).toBeInTheDocument();
  });
});
