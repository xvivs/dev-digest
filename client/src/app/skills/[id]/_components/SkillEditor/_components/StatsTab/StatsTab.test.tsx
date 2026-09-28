/**
 * StatsTab — driven through the REAL useSkillStats hook with only the
 * transport (`api`) faked. The fake parses every response through the schema
 * the hook hands it (ADR 0007), so fixtures are held to the SkillStats contract.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { EvalSuite, Skill, SkillStats } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../../messages/en/skills.json";
import costMessages from "../../../../../../../../messages/en/cost.json";

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: h.get } };
});

import { StatsTab } from "./StatsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "gate",
  description: "Flags untested branches.",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 3,
  needs_vetting: false,
};

const STATS: SkillStats = {
  skill_id: "sk1",
  window: "30d",
  usage: {
    runs: 142,
    agents: [
      { agent_id: "a2", agent_name: "Security pass", status: "blocked_by_vetting", runs: 0 },
      { agent_id: "a1", agent_name: "Strict reviewer", status: "effective", runs: 120 },
      { agent_id: "a3", agent_name: "Quick look", status: "link_disabled", runs: 22 },
    ],
  },
  cost: { tokens: 56_800, cost_usd: 0.17, cost_source: "estimated" },
  by_version: [
    { version: 2, runs: 40, tokens: 16_000, cost_usd: 0.05, cost_source: "estimated" },
    { version: 3, runs: 102, tokens: 40_800, cost_usd: 0.12, cost_source: "estimated" },
  ],
  impact: null,
};

const SUITE: EvalSuite = {
  id: "su1",
  skill_id: "sk1",
  skill_version: 3,
  prompt_sha256: "abc",
  carrier_agent_id: "a1",
  carrier_agent_version: 2,
  carrier_name: "Strict reviewer",
  model: "claude-sonnet",
  mode: "full",
  repeats: 3,
  status: "done",
  total_jobs: 120,
  done_jobs: 120,
  estimate_usd: 0.5,
  cost_usd: 0.42,
  cost_source: "provider",
  stale: false,
  results: { passing: 17, total: 20, caught: 3, regressed: 0, flaky: 2, delta_unexpected: 0.4, verdict: "helps" },
  error: null,
  created_at: "2026-09-29T10:00:00.000Z",
  started_at: "2026-09-29T10:00:00.000Z",
  finished_at: "2026-09-29T10:10:00.000Z",
};

function renderTab(window: SkillStats["window"] = "30d") {
  const onWindowChange = vi.fn();
  const onRunEvals = vi.fn();
  const view = renderWithProviders(
    <StatsTab skill={SKILL} window={window} onWindowChange={onWindowChange} onRunEvals={onRunEvals} />,
    { namespaces: { skills: messages, cost: costMessages } },
  );
  return { ...view, onWindowChange, onRunEvals };
}

// Parse through the schema the hook passes, as apiFetch does: a fixture that
// drifts from the SkillStats contract fails here instead of passing silently.
const withStats = (stats: SkillStats) =>
  h.get.mockImplementation((_path: string, schema?: { parse: (v: unknown) => unknown }) =>
    Promise.resolve(schema ? schema.parse(stats) : stats),
  );

beforeEach(() => {
  h.get.mockReset();
  withStats(STATS);
});
afterEach(cleanup);

describe("StatsTab", () => {
  it("with no evals shows Unknown and a Run evals CTA, then usage, cost and versions", async () => {
    const { onRunEvals } = renderTab();
    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith("/skills/sk1/stats?window=30d", expect.anything());
    expect(screen.getByText(/No evals yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    expect(onRunEvals).toHaveBeenCalledTimes(1);

    // Usage: busiest agent first, each linking to its Skills tab with its status.
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    const agents = within(screen.getByRole("table", { name: "Agents linking this skill" })).getAllByRole("row").slice(1);
    expect(agents.map((r) => within(r).getByRole("link").textContent)).toEqual([
      "Strict reviewer",
      "Quick look",
      "Security pass",
    ]);
    expect(within(agents[0]!).getByRole("link")).toHaveAttribute("href", "/agents/a1?tab=skills");
    expect(within(agents[0]!).getByText("Effective")).toBeInTheDocument();
    expect(within(agents[1]!).getByText("Link disabled")).toBeInTheDocument();
    expect(within(agents[2]!).getByText("Blocked by vetting").closest("[title]")).toHaveAttribute(
      "title",
      "The skill needs review and trust before agents use it.",
    );

    // Cost: an estimate is marked as one (ADR 0002), like every other cost surface.
    expect(screen.getByText("56,800")).toBeInTheDocument();
    expect(screen.getByText("~$0.170")).toHaveAttribute("title", expect.stringMatching(/estimated/i));

    // By version: newest first, current marked.
    const versions = within(screen.getByRole("table", { name: "Runs by skill version" })).getAllByRole("row").slice(1);
    expect(versions.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(["v3current", "v2"]);
    expect(within(versions[0]!).getByText("102")).toBeInTheDocument();
  });

  it("the window switcher marks the active window and asks for a new one", async () => {
    const { onWindowChange } = renderTab("7d");
    await screen.findByText("Unknown");
    expect(h.get).toHaveBeenCalledWith("/skills/sk1/stats?window=7d", expect.anything());
    const group = screen.getByRole("group", { name: "Time window" });
    expect(within(group).getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(group).getByRole("button", { name: "90d" }));
    expect(onWindowChange).toHaveBeenCalledWith("90d");
    fireEvent.click(within(group).getByRole("button", { name: "7d" }));
    expect(onWindowChange).toHaveBeenCalledTimes(1);
  });

  it("shows a done Full verdict with its carrier, pass rate and breakdown", async () => {
    withStats({ ...STATS, impact: { verdict: "helps", stale: false, suite: SUITE } });
    renderTab();
    expect(await screen.findByText("Helps")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.getByText("Carrier: Strict reviewer")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "85% of cases pass with the skill" })).toBeInTheDocument();
    expect(screen.getByText("17/20 passing")).toBeInTheDocument();
    expect(screen.getByText(/\+3 caught · 0 regressed · 2 flaky/)).toBeInTheDocument();
    expect(screen.getByText("Δunexpected +0.4")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.queryByText(/Indicative only/)).not.toBeInTheDocument();
  });

  it("an Indicative, stale verdict says why it is weak and offers a re-run", async () => {
    withStats({
      ...STATS,
      impact: {
        verdict: "indicative",
        stale: true,
        suite: { ...SUITE, mode: "quick", repeats: 1, stale: true, results: { ...SUITE.results!, verdict: "indicative" } },
      },
    });
    const { onRunEvals } = renderTab();
    expect(await screen.findByText("Indicative")).toBeInTheDocument();
    expect(screen.getByText("Quick")).toBeInTheDocument();
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText(/Indicative only/)).toBeInTheDocument();
    expect(screen.getByText(/changed since this eval ran/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-run evals" }));
    expect(onRunEvals).toHaveBeenCalledTimes(1);
  });

  it("a running suite shows its progress, not a verdict breakdown", async () => {
    withStats({
      ...STATS,
      impact: { verdict: "unknown", stale: false, suite: { ...SUITE, status: "running", done_jobs: 30, results: null } },
    });
    renderTab();
    expect(await screen.findByText("Eval in progress (30/120 jobs).")).toHaveAttribute("role", "status");
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
  });

  it("a failed suite surfaces its error", async () => {
    withStats({
      ...STATS,
      impact: { verdict: "unknown", stale: false, suite: { ...SUITE, status: "failed", results: null, error: "budget exceeded" } },
    });
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("budget exceeded");
  });

  it("an unpriced model shows a dash that says why, and empty sections say so", async () => {
    withStats({
      ...STATS,
      usage: { runs: 0, agents: [] },
      cost: { tokens: 400, cost_usd: null, cost_source: null },
      by_version: [],
    });
    renderTab();
    expect(await screen.findByText("No agent links this skill yet.")).toBeInTheDocument();
    expect(screen.getByText("—")).toHaveAttribute("title", expect.stringMatching(/no price/i));
    expect(screen.getByText("No completed runs used this skill in this window.")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("a load failure offers a retry that refetches", async () => {
    h.get.mockRejectedValueOnce(new Error("boom"));
    renderTab();
    expect(await screen.findByText("Could not load stats for this skill.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledTimes(2);
  });
});
