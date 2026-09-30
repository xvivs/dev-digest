import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, AgentSkillLink, SkillListItem } from "@devdigest/shared";
import { renderWithProviders, createTestQueryClient } from "@/test/render";
import messages from "../../../../../../../../messages/en/agents.json";

/* Only the transport is mocked — useSkills/useAgentSkills/useSetAgentSkills all
   run for real, so the debounce/optimistic-update/rollback logic in
   SkillsTab.tsx is exercised exactly as it runs against the live API, and the
   real query cache is what drives re-renders (the same cache SkillsTab writes
   to for its instant, pre-save UI feedback). */
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api";
import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function skill(id: string, name: string, extra: Partial<SkillListItem> = {}): SkillListItem {
  return {
    id,
    name,
    description: "",
    type: "rubric",
    source: "manual",
    body: "# rule",
    enabled: true,
    version: 1,
    needs_vetting: false,
    agent_count: 0,
    ...extra,
  };
}

// linked: alpha (order 0, enabled) and beta (order 1, DISABLED link); unlinked:
// zulu-skill and yankee-skill (alphabetical: yankee before zulu).
const SKILLS: SkillListItem[] = [
  skill("alpha", "alpha-rubric"),
  skill("beta", "beta-convention"),
  skill("zulu", "zulu-skill"),
  skill("yankee", "yankee-skill"),
];
const LINKS: AgentSkillLink[] = [
  { agent_id: AGENT.id, skill_id: "alpha", order: 0, enabled: true },
  { agent_id: AGENT.id, skill_id: "beta", order: 1, enabled: false },
];

/** A promise this test resolves/rejects on its own schedule, to control response order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const queryClient = createTestQueryClient();
  const get = vi.mocked(api.get);
  const put = vi.mocked(api.put);
  get.mockImplementation((path: string) => {
    if (path === "/skills") return Promise.resolve(SKILLS);
    if (path === `/agents/${AGENT.id}/skills`) return Promise.resolve(LINKS);
    throw new Error(`unexpected GET ${path}`);
  });
  const putCalls: { path: string; body: unknown; deferred: ReturnType<typeof deferred<AgentSkillLink[]>> }[] = [];
  put.mockImplementation((path: string, body: unknown) => {
    const d = deferred<AgentSkillLink[]>();
    putCalls.push({ path, body, deferred: d });
    return d.promise;
  });
  const view = renderWithProviders(<SkillsTab agent={AGENT} />, {
    namespaces: { agents: messages },
    queryClient,
  });
  return { ...view, putCalls };
}

/** Flushes React Query's pending work (queryFn/mutationFn resolution, its
 *  notify-and-rerender scheduling) under fake timers. Plain `await Promise.resolve()`
 *  loops are not enough here — React Query's internal scheduling needs an
 *  actual timer tick, which `advanceTimersByTimeAsync` provides while also
 *  awaiting the microtasks each tick unblocks. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Same idea as `settle`, run a few times — a resolved/rejected mutation's own
 *  promise chain (mutationFn → hook onSuccess/onError → this call's own
 *  onSuccess/onError) is deeper than one tick. */
async function settleDeep() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); // RTL asyncWrapper (userEvent) awaits a real setTimeout(0)
});

afterEach(() => {
  vi.useRealTimers();
});

describe("C2 SkillsTab — ordering and the enabled counter", () => {
  it("lists linked skills first (by order), then the rest by name, and shows N of M enabled", async () => {
    setup();
    await settle();

    // Each row's checkbox is named "Enable {name} for this agent" (SkillRow.tsx);
    // DOM order of the checkboxes is the row order.
    const expected = ["alpha-rubric", "beta-convention", "yankee-skill", "zulu-skill"].map((name) =>
      screen.getByRole("checkbox", { name: `Enable ${name} for this agent` }),
    );
    expect(screen.getAllByRole("checkbox")).toEqual(expected);
    // alpha is linked+enabled; beta is linked but its link is disabled — only alpha counts.
    expect(screen.getByText("1 of 4 enabled")).toBeInTheDocument();
  });
});

describe("C2 SkillsTab — autosave debounce", () => {
  it("sends ONE PUT with the full list 400ms after a ↑/↓ reorder", async () => {
    const { putCalls } = setup();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Move alpha-rubric down" }));
    expect(putCalls).toHaveLength(0); // not yet — still inside the debounce window

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.path).toBe(`/agents/${AGENT.id}/skills`);
    expect(putCalls[0]!.body).toEqual({
      links: [
        { skill_id: "beta", enabled: false },
        { skill_id: "alpha", enabled: true },
      ],
    });
  });

  it("coalesces two quick actions into one PUT carrying both changes", async () => {
    const { putCalls } = setup();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Move alpha-rubric down" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // well inside the 400ms window
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable zulu-skill for this agent" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.body).toEqual({
      links: [
        { skill_id: "beta", enabled: false },
        { skill_id: "alpha", enabled: true },
        { skill_id: "zulu", enabled: true },
      ],
    });
  });

  it("flushes a pending save on unmount instead of dropping it", async () => {
    const { putCalls, unmount } = setup();
    await settle();

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable zulu-skill for this agent" }));
    expect(putCalls).toHaveLength(0);

    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(putCalls).toHaveLength(1);

    // The early flush must cancel the queued debounce, not leave it to fire a
    // second PUT after the tab is gone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putCalls).toHaveLength(1);
  });
});

describe("C2 SkillsTab — response handling", () => {
  it("ignores a stale response that resolves after a newer save already completed", async () => {
    const { putCalls } = setup();
    await settle();

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable zulu-skill for this agent" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putCalls).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable yankee-skill for this agent" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putCalls).toHaveLength(2);

    // The SECOND (newer) save resolves first…
    const secondResponse: AgentSkillLink[] = [
      { agent_id: AGENT.id, skill_id: "alpha", order: 0, enabled: true },
      { agent_id: AGENT.id, skill_id: "beta", order: 1, enabled: false },
      { agent_id: AGENT.id, skill_id: "zulu", order: 2, enabled: true },
      { agent_id: AGENT.id, skill_id: "yankee", order: 3, enabled: true },
    ];
    putCalls[1]!.deferred.resolve(secondResponse);
    await settleDeep();
    // …then the FIRST (stale) one resolves late, without zulu's link.
    const firstResponseStale: AgentSkillLink[] = [
      { agent_id: AGENT.id, skill_id: "alpha", order: 0, enabled: true },
      { agent_id: AGENT.id, skill_id: "beta", order: 1, enabled: false },
      { agent_id: AGENT.id, skill_id: "zulu", order: 2, enabled: true },
    ];
    putCalls[0]!.deferred.resolve(firstResponseStale);
    await settleDeep();

    // yankee must still show enabled — the stale response never got applied.
    expect(screen.getByRole("checkbox", { name: "Enable yankee-skill for this agent" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("rolls back to the last confirmed state and shows the reason when a save fails", async () => {
    const { putCalls } = setup();
    await settle();

    const zuluCheckbox = () => screen.getByRole("checkbox", { name: "Enable zulu-skill for this agent" });
    fireEvent.click(zuluCheckbox());
    expect(zuluCheckbox()).toHaveAttribute("aria-checked", "true"); // instant optimistic feedback

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putCalls).toHaveLength(1);

    putCalls[0]!.deferred.reject(new Error("Budget exceeded: 26 KB > 24 KB"));
    await settleDeep();

    expect(zuluCheckbox()).toHaveAttribute("aria-checked", "false"); // rolled back
    expect(screen.getByRole("alert")).toHaveTextContent("Budget exceeded: 26 KB > 24 KB");
  });
});

describe("C2 SkillsTab — a click is never lost (QA: first click did nothing)", () => {
  const zuluBox = () => screen.getByRole("checkbox", { name: "Enable zulu-skill for this agent" });
  const yankeeBox = () => screen.getByRole("checkbox", { name: "Enable yankee-skill for this agent" });

  it("keeps a click made while the previous save is in flight, and saves it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { putCalls } = setup();
    await settle();

    await user.click(zuluBox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putCalls).toHaveLength(1); // first save is now in flight

    await user.click(yankeeBox()); // click inside the in-flight window, debounce armed again
    expect(yankeeBox()).toHaveAttribute("aria-checked", "true");

    putCalls[0]!.deferred.resolve([...LINKS, { agent_id: AGENT.id, skill_id: "zulu", order: 2, enabled: true }]);
    await settleDeep();

    // The first response must not wipe the newer, not-yet-sent click.
    expect(yankeeBox()).toHaveAttribute("aria-checked", "true");
    expect(zuluBox()).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putCalls).toHaveLength(2);
    expect(putCalls[1]!.body).toEqual({
      links: [
        { skill_id: "alpha", enabled: true },
        { skill_id: "beta", enabled: false },
        { skill_id: "zulu", enabled: true },
        { skill_id: "yankee", enabled: true },
      ],
    });
  });

  it("offers no checkbox before the agent's links load, then the first click sticks", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const queryClient = createTestQueryClient();
    const links = deferred<AgentSkillLink[]>();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === "/skills") return Promise.resolve(SKILLS);
      if (path === `/agents/${AGENT.id}/skills`) return links.promise;
      throw new Error(`unexpected GET ${path}`);
    });
    const putBodies: unknown[] = [];
    vi.mocked(api.put).mockImplementation((_path: string, body: unknown) => {
      putBodies.push(body);
      return new Promise<AgentSkillLink[]>(() => {});
    });
    renderWithProviders(<SkillsTab agent={AGENT} />, { namespaces: { agents: messages }, queryClient });
    await settle();

    // Skills are known, the links request is pending: nothing can be ticked on an empty baseline.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    links.resolve(LINKS);
    await settleDeep();

    await user.click(zuluBox());

    expect(zuluBox()).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putBodies).toEqual([
      {
        links: [
          { skill_id: "alpha", enabled: true },
          { skill_id: "beta", enabled: false },
          { skill_id: "zulu", enabled: true },
        ],
      },
    ]);
  });
});
