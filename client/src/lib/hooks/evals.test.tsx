import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { EvalSuite, EvalSuiteDetail } from "@devdigest/shared";
import { createTestQueryClient } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { EVAL_SUITE_POLL_INTERVAL_MS, useEvalSuite, useStartEvalSuite, useCreateEvalSuite } from "./evals";

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
  status: "running",
  total_jobs: 12,
  done_jobs: 4,
  estimate_usd: 0.5,
  cost_usd: null,
  cost_source: null,
  stale: false,
  results: null,
  error: null,
  created_at: "2026-09-29T10:00:00.000Z",
  started_at: "2026-09-29T10:00:00.000Z",
  finished_at: null,
};

const detail = (patch: Partial<EvalSuiteDetail> = {}): EvalSuiteDetail => ({ ...SUITE, cases: [], runs: [], ...patch });

const DONE = detail({
  status: "done",
  done_jobs: 12,
  cost_usd: 0.42,
  cost_source: "provider",
  results: { passing: 2, total: 2, caught: 1, regressed: 0, flaky: 0, delta_unexpected: 0, verdict: "indicative" },
  finished_at: "2026-09-29T10:10:00.000Z",
});

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

// Parse through the schema the hook hands over, as apiFetch does (ADR 0007).
const parsed = (value: unknown) => (_path: string, schema?: { parse: (v: unknown) => unknown }) =>
  Promise.resolve(schema ? schema.parse(value) : value);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useEvalSuite", () => {
  it("polls every 2 s while running, stops on done and then refreshes stats, the skill and the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockImplementationOnce(parsed(detail())).mockImplementationOnce(parsed(detail({ done_jobs: 8 }))).mockImplementation(parsed(DONE));
    const qc = createTestQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useEvalSuite("sk1", "su1"), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(result.current.data?.done_jobs).toBe(4));
    expect(get).toHaveBeenCalledWith("/eval-suites/su1", expect.anything());
    expect(invalidate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS));
    await waitFor(() => expect(result.current.data?.done_jobs).toBe(8));

    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS));
    await waitFor(() => expect(result.current.data?.status).toBe("done"));
    const keys = invalidate.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["skill-stats", "sk1"], ["skill", "sk1"], ["skills"], ["skill-eval-suites", "sk1"]]),
    );

    // Terminal: no further polls however long we wait.
    const calls = get.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS * 5));
    expect(get.mock.calls.length).toBe(calls);
  });

  it("does not poll or invalidate a suite that is already done on first load", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockImplementation(parsed(DONE));
    const qc = createTestQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useEvalSuite("sk1", "su1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(EVAL_SUITE_POLL_INTERVAL_MS * 3));
    expect(get).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not fetch without a suite id", () => {
    renderHook(() => useEvalSuite("sk1", null), { wrapper: wrapperFor(createTestQueryClient()) });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useCreateEvalSuite / useStartEvalSuite", () => {
  it("creates an estimate, then starts it body-less and seeds the detail as running", async () => {
    post.mockImplementationOnce((_p: string, _b: unknown, schema?: { parse: (v: unknown) => unknown }) =>
      Promise.resolve(schema!.parse({ ...SUITE, status: "estimated", done_jobs: 0 })),
    );
    const qc = createTestQueryClient();
    const create = renderHook(() => useCreateEvalSuite(), { wrapper: wrapperFor(qc) });
    let estimated: EvalSuite | undefined;
    await act(async () => {
      estimated = await create.result.current.mutateAsync({ skillId: "sk1", body: { carrier_agent_id: "a1", mode: "full" } });
    });
    expect(post).toHaveBeenCalledWith("/skills/sk1/eval-suites", { carrier_agent_id: "a1", mode: "full" }, expect.anything());
    expect(estimated?.status).toBe("estimated");

    post.mockImplementationOnce((_p: string, _b: unknown, schema?: { parse: (v: unknown) => unknown }) =>
      Promise.resolve(schema!.parse({ ...SUITE, done_jobs: 0 })),
    );
    get.mockImplementation(parsed(detail({ done_jobs: 0 })));
    const start = renderHook(() => useStartEvalSuite(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await start.result.current.mutateAsync({ skillId: "sk1", suiteId: "su1" });
    });
    expect(post).toHaveBeenLastCalledWith("/eval-suites/su1/start", undefined, expect.anything());
    expect(qc.getQueryData<EvalSuiteDetail>(["eval-suite", "su1"])?.status).toBe("running");
  });
});
