/**
 * EvalsTab — driven through the REAL eval hooks with only the transport
 * (`api`) faked. Every fake response is parsed through the schema the hook
 * hands over (ADR 0007), so fixtures are held to the skill-impact contracts.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within, waitFor, act } from "@testing-library/react";
import type {
  Agent,
  EvalCarrier,
  EvalSuite,
  EvalSuiteDetail,
  PrDetail,
  PrMeta,
  Repo,
  Skill,
  SkillEvalCase,
  SkillStats,
} from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { EVAL_SUITE_POLL_INTERVAL_MS } from "@/lib/hooks/evals";
import { renderWithProviders } from "@/test/render";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import costMessages from "../../../../../../../../messages/en/cost.json";

type Schema = { parse: (v: unknown) => unknown };
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: h.get, post: h.post, put: h.put, del: h.del } };
});

import { EvalsTab } from "./EvalsTab";

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

const PR_ID = "6f1c2a4e-9b7d-4c3a-8e21-0d5f6a7b8c9d";

const CASE_DEFECT: SkillEvalCase = {
  id: "c1",
  owner_kind: "skill",
  owner_id: "sk1",
  skill_id: "sk1",
  name: "stripe-key-leak",
  input_diff: "+a\n+b\n",
  input_files: null,
  input_meta: null,
  expected_output: {},
  expectation: {
    must_find: [{ file: "src/config.ts", min_severity: "CRITICAL", category: "security" }],
    must_not_find: [],
  },
  input_source: { kind: "pr", pr_id: PR_ID, pr_number: 42, head_sha: "abc", files: ["src/config.ts"] },
  notes: null,
};

const CASE_CLEAN: SkillEvalCase = {
  ...CASE_DEFECT,
  id: "c2",
  name: "clean-refactor",
  expectation: { must_find: [], must_not_find: [{ file: "src/util.ts" }] },
  input_source: { kind: "paste" },
};

const CASE_LEGACY: SkillEvalCase = { ...CASE_DEFECT, id: "c3", name: "old-case", expectation: null, input_source: null };

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
  results: { passing: 17, total: 20, caught: 3, regressed: 0, flaky: 2, errored: 0, delta_unexpected: 0.4, verdict: "helps" },
  error: null,
  created_at: "2026-09-29T10:00:00.000Z",
  started_at: "2026-09-29T10:00:00.000Z",
  finished_at: "2026-09-29T10:10:00.000Z",
};

const run = (case_id: string, arm: "with" | "without", repeat_idx: number, pass: boolean, unexpected: number) => ({
  id: `${case_id}-${arm}-${repeat_idx}`,
  suite_id: "su1",
  case_id,
  arm,
  repeat_idx,
  status: "done" as const,
  pass,
  matched: pass ? 1 : 0,
  expected: 1,
  unexpected,
  citation_accuracy: null,
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.01,
  cost_source: "provider" as const,
  duration_ms: 1000,
  error: null,
  ran_at: "2026-09-29T10:05:00.000Z",
});

const DETAIL: EvalSuiteDetail = {
  ...SUITE,
  cases: [
    { case_id: "c1", case_name: "stripe-key-leak", with: { passed: 3, total: 3 }, without: { passed: 0, total: 3 }, outcome: "caught", expected_count: 1, matched_median: 1, unexpected_median: 1.5, is_clean: false },
    { case_id: "c2", case_name: "clean-refactor", with: { passed: 2, total: 3 }, without: { passed: 3, total: 3 }, outcome: "flaky", expected_count: 0, matched_median: 0, unexpected_median: 0, is_clean: true },
  ],
  runs: [
    run("c1", "with", 0, true, 2),
    run("c1", "with", 1, true, 1),
    run("c1", "without", 0, false, 0),
    run("c2", "with", 0, true, 0),
    run("c2", "without", 0, true, 0),
  ],
};

const AGENTS = [
  { id: "a0", name: "Quick look", model: "gpt-4o-mini" },
  { id: "a1", name: "Strict reviewer", model: "claude-sonnet" },
  // Exists, but its link to the skill is disabled: never a carrier.
  { id: "a2", name: "General Reviewer", model: "gpt-4o" },
] as Agent[];

const CARRIERS: EvalCarrier[] = [
  { agent_id: "a1", agent_name: "Strict reviewer", runs: 120, is_default: true },
  { agent_id: "a0", agent_name: "Quick look", runs: 22, is_default: false },
];

const STATS: SkillStats = {
  skill_id: "sk1",
  window: "30d",
  usage: {
    runs: 142,
    agents: [
      { agent_id: "a0", agent_name: "Quick look", status: "effective", runs: 22 },
      { agent_id: "a1", agent_name: "Strict reviewer", status: "effective", runs: 120 },
    ],
  },
  cost: { tokens: 1000, cost_usd: 0.01, cost_source: "estimated" },
  by_version: [],
  impact: null,
};

const REPOS = [{ id: "r1", full_name: "acme/api" }] as Repo[];
const PULLS = [{ id: PR_ID, number: 42, title: "Add Stripe" }] as PrMeta[];
const PULL = {
  id: PR_ID,
  number: 42,
  files: [
    { path: "src/config.ts", additions: 3, deletions: 1, patch: "+x" },
    { path: "README.md", additions: 1, deletions: 0, patch: "+y" },
  ],
} as unknown as PrDetail;

const CASE_DETAIL = {
  case: {
    id: "c1",
    skill_id: "sk1",
    name: "stripe-key-leak",
    notes: null,
    expectation: CASE_DEFECT.expectation,
    input_source: CASE_DEFECT.input_source,
    input_files: ["src/config.ts"],
    input_diff_preview: "+a\n+b\n",
    input_diff_chars: 6,
    input_diff_truncated: false,
    created_at: "2026-09-29T09:00:00.000Z",
    updated_at: "2026-09-29T09:00:00.000Z",
  },
  suite: { id: "su1", mode: "full", status: "done", carrier_name: "Strict reviewer", skill_version: 3, repeats: 3, stale: false, partial: false, created_at: "2026-09-29T10:00:00.000Z" },
  arms: {
    with: { passed: 3, total: 3, matched_median: 1, unexpected_median: 1.5, runs: [0, 1, 2].map((i) => ({ repeat_idx: i, status: "done", pass: true, matched_must_find: [0], missed_must_find: [], unexpected: 1, unexpected_findings: [], duration_ms: 1000, cost_usd: 0.01, cost_source: "provider", error: null })) },
    without: { passed: 0, total: 3, matched_median: 0, unexpected_median: 0, runs: [] },
  },
  outcome: "caught",
  expectation_changed: false,
  history: [],
};

interface World {
  carriers: EvalCarrier[];
  cases: SkillEvalCase[];
  suites: EvalSuite[];
  detail: EvalSuiteDetail | (() => EvalSuiteDetail);
}
let world: World;

const answer = (value: unknown, schema?: Schema) => Promise.resolve(schema ? schema.parse(value) : value);

function routeGet(path: string, schema?: Schema) {
  if (path === "/skills/sk1/eval-cases") return answer(world.cases, schema);
  if (path === "/skills/sk1/eval-suites") return answer(world.suites, schema);
  if (path === "/eval-suites/su1") return answer(typeof world.detail === "function" ? world.detail() : world.detail, schema);
  if (path.startsWith("/eval-cases/c1")) return answer(CASE_DETAIL, schema);
  if (path === "/skills/sk1/eval-carriers") return answer(world.carriers, schema);
  if (path === "/agents") return answer(AGENTS, schema);
  if (path === "/skills/sk1/stats?window=30d") return answer(STATS, schema);
  if (path === "/repos") return answer(REPOS, schema);
  if (path === "/repos/r1/pulls") return answer(PULLS, schema);
  if (path === `/pulls/${PR_ID}`) return answer(PULL, schema);
  return Promise.reject(new ApiError(`unexpected GET ${path}`, 404));
}

/** The route owns `?case=` / `?suite=`; this stands in for it with plain state. */
function Harness({ skill, initialCase, initialSuite, spies }: { skill: Skill; initialCase: string | null; initialSuite: string | null; spies: Spies }) {
  const [caseId, setCaseId] = React.useState<string | null>(initialCase);
  const [suiteId, setSuiteId] = React.useState<string | null>(initialSuite);
  return (
    <EvalsTab
      skill={skill}
      onOpenConfig={spies.onOpenConfig}
      caseId={caseId}
      caseSuiteId={suiteId}
      onOpenCase={(id) => {
        spies.onOpenCase(id);
        setCaseId(id);
        setSuiteId(null);
      }}
      onCloseCase={() => {
        spies.onCloseCase();
        setCaseId(null);
        setSuiteId(null);
      }}
      onSelectCaseSuite={(id) => {
        spies.onSelectCaseSuite(id);
        setSuiteId(id);
      }}
    />
  );
}
type Spies = { onOpenConfig: () => void; onOpenCase: (id: string) => void; onCloseCase: () => void; onSelectCaseSuite: (id: string) => void };

function renderTab(skill: Skill = SKILL, opts: { initialCase?: string | null; initialSuite?: string | null } = {}) {
  const spies = { onOpenConfig: vi.fn(), onOpenCase: vi.fn(), onCloseCase: vi.fn(), onSelectCaseSuite: vi.fn() };
  const view = renderWithProviders(<Harness skill={skill} initialCase={opts.initialCase ?? null} initialSuite={opts.initialSuite ?? null} spies={spies} />, {
    namespaces: { eval: evalMessages, skills: skillsMessages, shell: shellMessages, cost: costMessages },
  });
  return { ...view, ...spies };
}

beforeEach(() => {
  world = { carriers: CARRIERS, cases: [CASE_DEFECT, CASE_CLEAN], suites: [SUITE], detail: DETAIL };
  h.get.mockReset().mockImplementation(routeGet);
  h.post.mockReset();
  h.put.mockReset();
  h.del.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EvalsTab — results", () => {
  it("header: title, amber P / T passing badge, both buttons; one thin suite line under it", async () => {
    renderTab();
    expect(await screen.findByRole("heading", { name: "Eval cases" })).toBeInTheDocument();
    expect(await screen.findByText("17 / 20 passing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New eval case" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeEnabled();
    expect(screen.queryByText(/Ablation eval/)).not.toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Latest suite" });
    expect(within(summary).getByText("+3 caught")).toBeInTheDocument();
    expect(within(summary).getByText("0 regressed")).toBeInTheDocument();
    expect(within(summary).getByText("2 flaky")).toBeInTheDocument();
    expect(within(summary).getByText("Δunexpected +0.4")).toBeInTheDocument();
    expect(within(summary).getByText("$0.420")).toBeInTheDocument();
    expect(within(summary).getByText("Helps")).toBeInTheDocument();
    expect(within(summary).getByText("Full")).toBeInTheDocument();
    expect(within(summary).getByText("Carrier: Strict reviewer")).toBeInTheDocument();
    expect(within(summary).queryByText(/passing/)).not.toBeInTheDocument();
    expect(summary).not.toHaveAttribute("title");
  });

  it("marks a Quick (indicative) and stale suite in the line's tooltip, and a legacy case as skipped", async () => {
    const quick: EvalSuite = {
      ...SUITE,
      mode: "quick",
      repeats: 1,
      stale: true,
      results: { ...SUITE.results!, verdict: "indicative" },
    };
    world = { carriers: CARRIERS, cases: [CASE_LEGACY], suites: [quick], detail: { ...DETAIL, ...quick, cases: [], runs: [] } };
    renderTab();
    const summary = await screen.findByRole("region", { name: "Latest suite" });
    expect(within(summary).getByText("Indicative")).toBeInTheDocument();
    expect(within(summary).getByText("stale")).toBeInTheDocument();
    expect(within(summary).getByText("Quick")).toBeInTheDocument();
    expect(summary).toHaveAttribute("title", expect.stringContaining("Indicative only"));
    expect(summary).toHaveAttribute("title", expect.stringContaining("changed since this suite ran"));
    expect(screen.getByText("legacy expectations, skipped")).toBeInTheDocument();
    // Only a legacy case: nothing to run, on the card either.
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run old-case" })).toBeDisabled();
  });

  it("ignores estimate-only suites and shows the empty state with no cases", async () => {
    world = { carriers: CARRIERS, cases: [], suites: [{ ...SUITE, id: "est", status: "estimated", results: null }], detail: DETAIL };
    renderTab();
    expect(await screen.findByText(/No eval cases yet/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Latest suite" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    expect(h.get).not.toHaveBeenCalledWith("/eval-suites/est", expect.anything());
  });

  it("polls a running suite, shows progress, and swaps in the results when it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running: EvalSuiteDetail = { ...DETAIL, status: "running", done_jobs: 30, results: null, cost_usd: null, cost_source: null, cases: [], runs: [] };
    let calls = 0;
    world = { ...world, suites: [{ ...SUITE, status: "running", results: null }], detail: () => (++calls >= 2 ? DETAIL : running) };
    renderTab();
    expect(await screen.findByText("Running 30/120 jobs")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Suite progress" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS));
    expect(await screen.findByText("17 / 20 passing")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("cancels a running suite", async () => {
    world = { ...world, suites: [{ ...SUITE, status: "running", results: null }], detail: { ...DETAIL, status: "running", results: null } };
    h.post.mockImplementation((path: string, _b: unknown, schema?: Schema) =>
      path === "/eval-suites/su1/cancel" ? answer({ ...SUITE, status: "cancelled", results: null }, schema) : Promise.reject(new Error(path)),
    );
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/eval-suites/su1/cancel", undefined, expect.anything()));
  });
});

describe("EvalsTab — Run modal", () => {
  const estimated: EvalSuite = { ...SUITE, id: "su2", status: "estimated", done_jobs: 0, results: null, cost_usd: null, cost_source: null, total_jobs: 12, estimate_usd: 0.36 };

  async function openModal() {
    const view = renderTab();
    await screen.findByText("stripe-key-leak");
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    const dialog = await screen.findByRole("dialog", { name: "Run on evals" });
    // Preselected: the server's `is_default` carrier (decision 5).
    await waitFor(() => expect(within(dialog).getByLabelText("Carrier agent")).toHaveValue("a1"));
    return { ...view, dialog };
  }

  it("lists only the eligible carriers (enabled link), never an agent that does not link the skill", async () => {
    const { dialog } = await openModal();
    const options = within(within(dialog).getByLabelText("Carrier agent")).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["a1", "a0"]);
    expect(within(dialog).queryByText(/General Reviewer/)).not.toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalledWith("/agents", expect.anything());
  });

  it("with no eligible carrier: empty state pointing to Agents, and Estimate is disabled", async () => {
    world.carriers = [];
    const view = renderTab();
    await screen.findByText("stripe-key-leak");
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    const dialog = await screen.findByRole("dialog", { name: "Run on evals" });
    expect(await within(dialog).findByText("Link this skill to an agent (enabled) to run evals")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open Agents" })).toHaveAttribute("href", "/agents");
    expect(within(dialog).queryByLabelText("Carrier agent")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Estimate" })).toBeDisabled();
    view.unmount();
  });

  it("a carrier that lost its link between load and Estimate reads as 'link the skill'", async () => {
    h.post.mockRejectedValue(new ApiError("not linked", 422, "eval_carrier_not_linked"));
    const { dialog } = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/enabled link/);
  });

  it("estimates, shows $ and call count, then starts the priced suite", async () => {
    h.post.mockImplementation((path: string, _b: unknown, schema?: Schema) => {
      if (path === "/skills/sk1/eval-suites") return answer(estimated, schema);
      if (path === "/eval-suites/su2/start") return answer({ ...estimated, status: "running" }, schema);
      return Promise.reject(new Error(path));
    });
    const { dialog } = await openModal();
    expect(within(dialog).getByRole("radio", { name: /Full/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Quick/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Full/ }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith("/skills/sk1/eval-suites", { carrier_agent_id: "a1", mode: "full" }, expect.anything()),
    );
    expect(await within(dialog).findByText(/^~\$0\.36/)).toBeInTheDocument();
    expect(within(dialog).getByText("12 model calls · 2 cases × 2 arms × 3 repeats")).toBeInTheDocument();
    expect(within(dialog).getByText("Model: claude-sonnet")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/eval-suites/su2/start", undefined, expect.anything()));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("changing the mode after an estimate drops it, so Start never runs an unpriced suite", async () => {
    h.post.mockImplementation((_p: string, _b: unknown, schema?: Schema) => answer(estimated, schema));
    const { dialog } = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    expect(await within(dialog).findByRole("button", { name: "Start" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Quick/ }));
    expect(within(dialog).queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
  });

  it("shows the trust gate as 'vet skill first' with a way to Config", async () => {
    h.post.mockRejectedValue(new ApiError("Skill is not vetted", 409, "eval_skill_not_vetted"));
    const { dialog, onOpenConfig } = await openModal();
    fireEvent.change(within(dialog).getByLabelText("Carrier agent"), { target: { value: "a0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith("/skills/sk1/eval-suites", { carrier_agent_id: "a0", mode: "full" }, expect.anything()),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/^Vet skill first/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Open Config" }));
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a stale estimate at Start asks to estimate again", async () => {
    h.post.mockImplementation((path: string, _b: unknown, schema?: Schema) =>
      path === "/skills/sk1/eval-suites"
        ? answer(estimated, schema)
        : Promise.reject(new ApiError("stale", 409, "eval_suite_stale")),
    );
    const { dialog } = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Start" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("changed since the estimate");
    expect(within(dialog).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
  });
});

describe("EvalsTab — case editor", () => {
  const created = (body: unknown) => ({ ...CASE_DEFECT, id: "c9", ...(body as object) });

  it("creates a pasted defect case with a must_find row", async () => {
    h.post.mockImplementation((_p: string, body: unknown, schema?: Schema) =>
      answer({ ...created(body), expectation: (body as { expectation: unknown }).expectation, input_source: { kind: "paste" } }, schema),
    );
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "New eval case" }));
    const dialog = await screen.findByRole("dialog", { name: "New eval case" });

    // Saving an empty form names what is missing instead of calling the API.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Give the case a name.");

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "leak" } });
    fireEvent.change(within(dialog).getByLabelText("Unified diff"), { target: { value: "+key" } });
    const row = within(dialog).getByRole("listitem", { name: "Expectation 1" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Row 1: the file path is required.");

    fireEvent.change(within(row).getByLabelText("File"), { target: { value: "src/config.ts" } });
    fireEvent.change(within(row).getByLabelText("From line"), { target: { value: "10" } });
    fireEvent.change(within(row).getByLabelText("Min severity"), { target: { value: "CRITICAL" } });
    fireEvent.change(within(row).getByLabelText("Category"), { target: { value: "security" } });
    fireEvent.change(within(row).getByLabelText("Contains"), { target: { value: "sk_live" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));

    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledWith(
      "/skills/sk1/eval-cases",
      {
        name: "leak",
        source: { kind: "paste", diff: "+key" },
        expectation: {
          must_find: [
            { file: "src/config.ts", line_range: { start: 10, end: 10 }, min_severity: "CRITICAL", category: "security", contains: "sk_live" },
          ],
        },
      },
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("builds a clean case from a synced PR's picked files", async () => {
    h.post.mockImplementation((_p: string, body: unknown, schema?: Schema) =>
      answer({ ...created(body), expectation: (body as { expectation: unknown }).expectation }, schema),
    );
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "New eval case" }));
    const dialog = await screen.findByRole("dialog", { name: "New eval case" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "clean-pr" } });

    fireEvent.change(within(dialog).getByLabelText("Unified diff"), { target: { value: "+kept" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "From PR" }));
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "acme/api" })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Repository"), { target: { value: "r1" } });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "#42 Add Stripe" })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Pull request"), { target: { value: PR_ID } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /src\/config\.ts/ }));

    // The pasted diff survives a trip to the other tab and back.
    fireEvent.click(within(dialog).getByRole("button", { name: "Paste diff" }));
    expect(within(dialog).getByLabelText("Unified diff")).toHaveValue("+kept");
    fireEvent.click(within(dialog).getByRole("button", { name: "From PR" }));
    expect(within(dialog).getByRole("checkbox", { name: /src\/config\.ts/ })).toBeChecked();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Clean case/ }));
    const row = within(dialog).getByRole("listitem", { name: "Expectation 1" });
    fireEvent.change(within(row).getByLabelText("File"), { target: { value: "src/config.ts" } });
    fireEvent.change(within(row).getByLabelText("Min severity"), { target: { value: "" } });
    fireEvent.change(within(row).getByLabelText("Category"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));

    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith(
        "/skills/sk1/eval-cases",
        {
          name: "clean-pr",
          source: { kind: "pr", pr_id: PR_ID, files: ["src/config.ts"] },
          expectation: { must_not_find: [{ file: "src/config.ts" }] },
        },
        expect.anything(),
      ),
    );
  });

  it("edits a case without re-sending its diff, and surfaces a server error inline", async () => {
    h.put.mockRejectedValueOnce(new ApiError("File is no longer in the PR", 422, "eval_case_file_not_in_pr"));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Edit stripe-key-leak" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit case · stripe-key-leak" });
    expect(within(dialog).getByText("Current diff: PR #42, 2 lines")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("File")).toHaveValue("src/config.ts");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "stripe-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }));
    await waitFor(() =>
      expect(h.put).toHaveBeenCalledWith(
        "/eval-cases/c1",
        { name: "stripe-key", expectation: { must_find: [{ file: "src/config.ts", min_severity: "CRITICAL", category: "security" }] } },
        expect.anything(),
      ),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("File is no longer in the PR");
  });

  it("deletes a case only after confirming", async () => {
    h.del.mockResolvedValue({ ok: true });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Delete clean-refactor" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete case?" });
    expect(h.del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith("/eval-cases/c2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("EvalsTab — header request", () => {
  it("opens the Run modal when the editor header asks, then acknowledges it", async () => {
    const handled = vi.fn();
    renderWithProviders(<EvalsTab skill={SKILL} runRequested onRunRequestHandled={handled} onOpenConfig={vi.fn()} />, {
      namespaces: { eval: evalMessages, skills: skillsMessages, shell: shellMessages, cost: costMessages },
    });
    expect(await screen.findByRole("dialog", { name: "Run on evals" })).toBeInTheDocument();
    expect(handled).toHaveBeenCalledTimes(1);
  });
});

describe("EvalsTab — errored cases", () => {
  const TIMEOUT_MSG = "Timed out after 1560s; the model call may still finish and replace this result";
  const errored = () => {
    const suite: EvalSuite = {
      ...SUITE,
      mode: "quick",
      repeats: 1,
      results: { passing: 0, total: 0, caught: 0, regressed: 0, flaky: 0, errored: 1, delta_unexpected: 0, verdict: "indicative" },
    };
    world = {
      carriers: CARRIERS,
      cases: [CASE_DEFECT],
      suites: [suite],
      detail: {
        ...DETAIL,
        ...suite,
        cases: [{ case_id: "c1", case_name: "stripe-key-leak", with: { passed: 0, total: 1 }, without: { passed: 1, total: 1 }, outcome: "error" }],
        runs: [
          { ...run("c1", "with", 0, false, 0), status: "failed" as const, pass: null, error: TIMEOUT_MSG },
          run("c1", "without", 0, true, 0),
        ],
      },
    };
  };

  it("header says N errored (warning) only when > 0, next to a passing badge that ignores the error", async () => {
    errored();
    renderTab();
    const summary = await screen.findByRole("region", { name: "Latest suite" });
    expect(screen.getByText("0 / 0 passing")).toBeInTheDocument();
    expect(within(summary).getByText("1 errored")).toBeInTheDocument();
  });

  it("no errored chip on a clean suite", async () => {
    renderTab();
    const summary = await screen.findByRole("region", { name: "Latest suite" });
    expect(within(summary).queryByText(/errored/)).not.toBeInTheDocument();
  });

  it("an errored card shows the error icon and 'run failed', no chip; the message lives in the drawer", async () => {
    errored();
    renderTab();
    const card = await screen.findByRole("button", { name: /stripe-key-leak: errored/ });
    expect(within(card).getByText("run failed")).toBeInTheDocument();
    expect(within(card).queryByText("error")).not.toBeInTheDocument();
    expect(screen.queryByText(TIMEOUT_MSG)).not.toBeInTheDocument();
  });
});

describe("EvalsTab — lean case cards", () => {
  const cardResult = (case_id: string, over: Record<string, unknown>) => ({
    case_id,
    case_name: case_id,
    with: { passed: 3, total: 3 },
    without: { passed: 0, total: 3 },
    outcome: "caught" as const,
    expected_count: 1,
    matched_median: 1,
    unexpected_median: 0,
    is_clean: false,
    ...over,
  });
  const named = (id: string, name: string, over: Partial<SkillEvalCase> = {}): SkillEvalCase => ({ ...CASE_DEFECT, id, name, ...over });

  function setWorld(cases: SkillEvalCase[], results: ReturnType<typeof cardResult>[]) {
    world = { carriers: CARRIERS, cases, suites: [SUITE], detail: { ...DETAIL, cases: results, runs: [] } };
  }

  it("caught: green check, expected/matched subtitle, severity tag and a caught chip", async () => {
    renderTab();
    const card = await screen.findByRole("button", { name: /stripe-key-leak: passes with the skill/ });
    expect(within(card).getByText("expected 1 finding, matched 1")).toBeInTheDocument();
    expect(within(card).getByText("CRITICAL · security")).toBeInTheDocument();
    expect(within(card).getByText("caught")).toBeInTheDocument();
    // Removed from the card: source, tallies, unexpected badge, must-find count.
    for (const gone of [/PR #42/, /with 3\/3/, /without/, /unexpected/, /must find/]) {
      expect(within(card).queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it("clean + flaky: 'expected 0 findings, got U', empty [] tag, amber flaky chip", async () => {
    renderTab();
    const card = await screen.findByRole("button", { name: /clean-refactor: flaky with the skill/ });
    expect(within(card).getByText("expected 0 findings, got 0")).toBeInTheDocument();
    expect(within(card).getByText("empty []")).toBeInTheDocument();
    expect(within(card).getByText("flaky")).toBeInTheDocument();
  });

  it("uses the median: matched can be a half", async () => {
    setWorld([named("c1", "half")], [cardResult("c1", { case_name: "half", expected_count: 2, matched_median: 1.5, outcome: "pass_both" })]);
    renderTab();
    expect(await screen.findByText("expected 2 findings, matched 1.5")).toBeInTheDocument();
  });

  it("pass_both and fail_both get no chip; fail shows a red state; regressed gets a chip", async () => {
    setWorld(
      [named("c1", "steady"), named("c2", "broken"), named("c3", "worse")],
      [
        cardResult("c1", { outcome: "pass_both", without: { passed: 3, total: 3 } }),
        cardResult("c2", { outcome: "fail_both", with: { passed: 0, total: 3 }, matched_median: 0 }),
        cardResult("c3", { outcome: "regressed", with: { passed: 0, total: 3 }, without: { passed: 3, total: 3 }, matched_median: 0 }),
      ],
    );
    renderTab();
    const steady = await screen.findByRole("button", { name: /steady: passes with the skill/ });
    const broken = screen.getByRole("button", { name: /broken: fails with the skill/ });
    const worse = screen.getByRole("button", { name: /worse: fails with the skill/ });
    for (const [card, label] of [[steady, /passes both/], [broken, /fails both/]] as const) {
      expect(within(card).queryByText(label)).not.toBeInTheDocument();
    }
    expect(within(worse).getByText("regressed")).toBeInTheDocument();
  });

  it("never run: grey dot, 'never run', no chip, still has the tag", async () => {
    setWorld([named("c1", "fresh")], []);
    renderTab();
    const card = await screen.findByRole("button", { name: /fresh: never run/ });
    expect(await within(card).findByText("never run")).toBeInTheDocument();
    expect(within(card).getByText("CRITICAL · security")).toBeInTheDocument();
  });

  it("several must_find rows: first row tag plus '+k more'", async () => {
    const many = named("c1", "multi", {
      expectation: {
        must_find: [
          { file: "a.ts", min_severity: "WARNING", category: "bug" },
          { file: "b.ts", min_severity: "CRITICAL", category: "security" },
          { file: "c.ts", min_severity: "CRITICAL", category: "security" },
        ],
        must_not_find: [],
      },
    });
    setWorld([many], [cardResult("c1", { expected_count: 3, matched_median: 2 })]);
    renderTab();
    expect(await screen.findByText("WARNING · bug +2 more")).toBeInTheDocument();
  });

  it("clicking the card, and Enter or Space on it, open the drawer; the action icons do not", async () => {
    const { onOpenCase } = renderTab();
    const card = await screen.findByRole("button", { name: /stripe-key-leak: passes/ });
    fireEvent.click(card);
    expect(onOpenCase).toHaveBeenCalledWith("c1");
    expect(await screen.findByRole("dialog", { name: "stripe-key-leak" })).toBeInTheDocument();
    cleanup();

    const again = renderTab();
    const cardAgain = await screen.findByRole("button", { name: /stripe-key-leak: passes/ });
    fireEvent.keyDown(cardAgain, { key: "Enter" });
    fireEvent.keyDown(cardAgain, { key: " " });
    expect(again.onOpenCase).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Edit stripe-key-leak" }));
    expect(again.onOpenCase).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("dialog", { name: "Edit case · stripe-key-leak" })).toBeInTheDocument();
  });
});

describe("EvalsTab — case drawer", () => {
  it("a ?case= deep link opens the drawer with the case's details, asking for ?suite= when given", async () => {
    renderTab(SKILL, { initialCase: "c1", initialSuite: "su1" });
    const dialog = await screen.findByRole("dialog", { name: "stripe-key-leak" });
    expect(await within(dialog).findByText("Summary")).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith("/eval-cases/c1?suite_id=su1", expect.anything());
  });

  it("closes through the close button, and focus returns to the card", async () => {
    const { onCloseCase } = renderTab();
    const card = await screen.findByRole("button", { name: /stripe-key-leak: passes/ });
    card.focus();
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog", { name: "stripe-key-leak" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onCloseCase).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /stripe-key-leak: passes/ })).toHaveFocus();
  });

  it("a deep-linked drawer, when closed, focuses the card too", async () => {
    renderTab(SKILL, { initialCase: "c1" });
    const dialog = await screen.findByRole("dialog", { name: "stripe-key-leak" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /stripe-key-leak: passes/ })).toHaveFocus();
  });

  it("a ?case= that names no case of the skill closes the drawer", async () => {
    const { onCloseCase } = renderTab(SKILL, { initialCase: "ghost" });
    await waitFor(() => expect(onCloseCase).toHaveBeenCalled());
  });

  it("Edit in the drawer opens the case editor", async () => {
    renderTab(SKILL, { initialCase: "c1" });
    const dialog = await screen.findByRole("dialog", { name: "stripe-key-leak" });
    await within(dialog).findByText("Summary");
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "Edit case · stripe-key-leak" })).toBeInTheDocument();
  });
});

describe("EvalsTab — per-case run", () => {
  const estimatedOne: EvalSuite = { ...SUITE, id: "su9", status: "estimated", done_jobs: 0, results: null, cost_usd: null, cost_source: null, total_jobs: 6, estimate_usd: 0.05, case_ids: ["c1"], partial: true };

  function wirePost() {
    h.post.mockImplementation((path: string, _b: unknown, schema?: Schema) => {
      if (path === "/skills/sk1/eval-suites") return answer(estimatedOne, schema);
      if (path === "/eval-suites/su9/start") return answer({ ...estimatedOne, status: "running" }, schema);
      return Promise.reject(new Error(path));
    });
  }

  it("the card's Run opens the Run modal for that one case and estimates with case_ids", async () => {
    wirePost();
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Run stripe-key-leak" }));
    const dialog = await screen.findByRole("dialog", { name: "Run case" });
    expect(within(dialog).getByText(/Runs “stripe-key-leak”/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Carrier agent")).toHaveValue("a1"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith("/skills/sk1/eval-suites", { carrier_agent_id: "a1", mode: "full", case_ids: ["c1"] }, expect.anything()),
    );
    expect(await within(dialog).findByText("1 case × 2 arms × 3 repeats", { exact: false })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/eval-suites/su9/start", undefined, expect.anything()));
  });

  it("Run all still sends no case_ids", async () => {
    wirePost();
    renderTab();
    await screen.findByText("stripe-key-leak");
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    const dialog = await screen.findByRole("dialog", { name: "Run on evals" });
    await waitFor(() => expect(within(dialog).getByLabelText("Carrier agent")).toHaveValue("a1"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Estimate" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/skills/sk1/eval-suites", { carrier_agent_id: "a1", mode: "full" }, expect.anything()));
  });

  it("the drawer's Run this case opens the same per-case modal", async () => {
    renderTab(SKILL, { initialCase: "c1" });
    const drawer = await screen.findByRole("dialog", { name: "stripe-key-leak" });
    await within(drawer).findByText("Summary");
    fireEvent.click(within(drawer).getByRole("button", { name: "Run this case" }));
    expect(await screen.findByRole("dialog", { name: "Run case" })).toBeInTheDocument();
  });

  it("every Run is disabled while a suite is running", async () => {
    world = { ...world, suites: [{ ...SUITE, status: "running", results: null }], detail: { ...DETAIL, status: "running", results: null } };
    renderTab();
    expect(await screen.findByRole("button", { name: "Run stripe-key-leak" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });

  it("a newer per-case suite overrides its own card only; header and summary stay on the whole-skill suite", async () => {
    const partialSuite: EvalSuite = { ...SUITE, id: "su7", case_ids: ["c1"], partial: true, results: { ...SUITE.results!, passing: 0, total: 1, verdict: "indicative" } };
    const partialDetail = {
      ...DETAIL,
      ...partialSuite,
      cases: [{ case_id: "c1", case_name: "stripe-key-leak", with: { passed: 0, total: 1 }, without: { passed: 1, total: 1 }, outcome: "regressed", expected_count: 1, matched_median: 0, unexpected_median: 0, is_clean: false }],
      runs: [],
    };
    world = { ...world, suites: [partialSuite, SUITE] };
    const base = routeGet;
    h.get.mockImplementation((path: string, schema?: Schema) => (path === "/eval-suites/su7" ? answer(partialDetail, schema) : base(path, schema)));
    renderTab();
    const card = await screen.findByRole("button", { name: /stripe-key-leak: fails with the skill/ });
    expect(within(card).getByText("regressed")).toBeInTheDocument();
    expect(within(card).getByText("expected 1 finding, matched 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clean-refactor: flaky/ })).toBeInTheDocument();
    expect(screen.getByText("17 / 20 passing")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Latest suite" })).getByText("Helps")).toBeInTheDocument();
  });
});
