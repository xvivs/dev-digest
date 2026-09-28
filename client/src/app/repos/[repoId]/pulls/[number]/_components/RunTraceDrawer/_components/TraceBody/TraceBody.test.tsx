import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { RunTrace } from "@devdigest/shared";
import runs from "@/../messages/en/runs.json";
import cost from "@/../messages/en/cost.json";
import shell from "@/../messages/en/shell.json";
import { renderWithProviders } from "@/test/render";

// TraceBody looks up skills_used ids against the workspace's current skills
// to tell a live one from a deleted one (SPEC-02 AC-27) — mock so the test
// controls exactly which ids are "still there" without a real fetch.
const knownSkills = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useSkills: () => knownSkills(),
}));

import { TraceBody } from "./TraceBody";

afterEach(cleanup);

const BASE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: {
    duration_ms: 8200,
    tokens_in: 12000,
    tokens_out: 1500,
    findings: 0,
    grounding: "2/2 passed",
    cost_usd: 0.0013,
    cost_source: "provider",
    cost_missing_reason: null,
  },
  prompt_assembly: { system: "You are a reviewer.", skills: null, memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

function renderTrace(trace: RunTrace) {
  const view = renderWithProviders(<TraceBody trace={trace} findings={[]} />, { namespaces: { runs, cost, shell } });
  // "Prompt assembly" starts collapsed (TraceBody.tsx), so every PromptBlock
  // inside it — including "Skills (dynamic)" — is not in the tree until opened.
  fireEvent.click(screen.getByRole("button", { name: "Prompt assembly" }));
  return view;
}

describe("C2 TraceBody — Skills prompt block (SPEC-02 AC-27..29)", () => {
  it("shows the skills token count and marks a skill no longer in the workspace as deleted", () => {
    knownSkills.mockReturnValue({ data: [{ id: "skill-live" }], isLoading: false });

    renderTrace({
      ...BASE,
      prompt_assembly: {
        ...BASE.prompt_assembly,
        skills: "### branch-coverage-gate\n...\n### old-rubric\n...",
        skills_tokens: 2300,
        skills_used: [
          { id: "skill-live", name: "branch-coverage-gate", version: 2, sha256: "abc", tokens: 1800 },
          { id: "skill-gone", name: "old-rubric", version: 1, sha256: "def", tokens: 500 },
        ],
      },
    });

    // The token count is in the block's header, visible even collapsed.
    expect(screen.getByText("≈2.3k tokens")).toBeInTheDocument();

    // Expand the block to reach the skills_used list.
    fireEvent.click(screen.getByRole("button", { name: /^Skills \(dynamic\)/ }));

    expect(screen.getByText("branch-coverage-gate")).toBeInTheDocument();
    expect(screen.getByText("v2 · ≈1.8k tokens")).toBeInTheDocument();
    expect(screen.getByText("old-rubric")).toBeInTheDocument();
    expect(screen.getByText("v1 · ≈500 tokens")).toBeInTheDocument();
    expect(screen.getByText("deleted")).toBeInTheDocument();
    // Only the skill missing from the live catalog is marked deleted.
    expect(screen.getByText("branch-coverage-gate").closest("div")?.textContent).not.toContain("deleted");
  });

  it("renders a trace that predates skills_tokens/skills_used unchanged", () => {
    knownSkills.mockReturnValue({ data: [], isLoading: false });

    renderTrace({
      ...BASE,
      prompt_assembly: { ...BASE.prompt_assembly, skills: "### some-skill\n..." },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Skills \(dynamic\)/ }));

    expect(document.body.textContent).toContain("some-skill");
    expect(screen.queryByText(/^≈/)).not.toBeInTheDocument();
    expect(screen.queryByText("deleted")).not.toBeInTheDocument();
  });

  it("renders no Skills block at all when the run used no skills", () => {
    knownSkills.mockReturnValue({ data: [], isLoading: false });
    renderTrace(BASE); // prompt_assembly.skills is null

    expect(screen.queryByRole("button", { name: /^Skills \(dynamic\)/ })).not.toBeInTheDocument();
  });
});
