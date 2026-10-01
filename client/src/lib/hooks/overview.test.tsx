/* Spec 06 D13 / AC-16: readiness polling, the in-flight → idle invalidation
   and the prepare mutation's cache seeding. Runs the real api client over a
   fake fetch, so every answer is parsed through the contract (ADR 0007). */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { PrOverviewReadiness } from "@devdigest/shared";
import { createTestQueryClient } from "@/test/render";
import { json, setupFakeApi } from "@/test/fake-api";
import { usePrBlast, usePrIntent, usePrRisks } from "./brief";
import { useRepos } from "./core";
import { OVERVIEW_READINESS_POLL_MS, markOverviewIndexRunStarted, overviewReadinessKey, usePrepareOverview, usePrOverviewReadiness, type OnReadiness } from "./overview";
import { useRepoIntelStatus } from "./repo-intel";

const READY: PrOverviewReadiness = {
  pr_id: "p1",
  repo_id: "r1",
  clone: { status: "cloned", in_flight: false, last_failure: null },
  index: { status: "full", in_flight: false, last_indexed_at: null, last_indexed_sha: "abcdef1234", partial_reason: null },
  brief: { intent: "fresh", risks: "fresh", in_flight: false, intent_failure: null, risks_failure: null },
  blocked_by: null,
  actions: [],
  explicit_actions: [],
  in_flight: false,
};
const BUSY: PrOverviewReadiness = { ...READY, index: { ...READY.index, in_flight: true }, in_flight: true };

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const READINESS = "/pulls/p1/overview/readiness";
const DEPENDENTS = [
  ["GET", "/pulls/p1/intent"],
  ["GET", "/pulls/p1/risks"],
  ["GET", "/pulls/p1/blast"],
  ["GET", "/repos/r1/index-state"],
  ["GET", "/repos"],
] as const;

/** Readiness plus one live observer of each query a finished prepare can change. */
function useOverviewScreen(onReadiness?: OnReadiness) {
  const readiness = usePrOverviewReadiness("p1", { onReadiness });
  usePrIntent("p1");
  usePrRisks("p1");
  usePrBlast("p1");
  useRepoIntelStatus("r1");
  useRepos();
  return readiness;
}

function replyDependents(api: ReturnType<typeof setupFakeApi>) {
  const brief = { stale: false, in_flight: false, last_failure: null };
  api.reply("GET", "/pulls/p1/intent", { intent: null, ...brief });
  api.reply("GET", "/pulls/p1/risks", { risks: null, ...brief });
  api.reply("GET", "/pulls/p1/blast", {
    status: "unavailable",
    reason: "no_index",
    blast: null,
    head_sha: "abc",
    source_sha: null,
    index_status: "none",
    cached: false,
    truncated: false,
    computed_at: null,
  });
  api.reply("GET", "/repos/r1/index-state", {});
  api.reply("GET", "/repos", []);
}

const dependentRequests = (api: ReturnType<typeof setupFakeApi>) =>
  DEPENDENTS.map(([method, path]) => api.requestsTo(method, path).length);

describe("usePrOverviewReadiness", () => {
  const api = setupFakeApi();
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls every 2 s while in flight; on the idle answer refetches the dependent queries once, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [BUSY, BUSY, READY];
    api.route("GET", READINESS, () => json(answers.shift() ?? READY));
    replyDependents(api);
    const seen: Array<[PrOverviewReadiness | undefined, PrOverviewReadiness]> = [];
    const { result } = renderHook(() => useOverviewScreen((prev, next) => seen.push([prev, next])), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data?.in_flight).toBe(true));
    await waitFor(() => expect(dependentRequests(api)).toEqual([1, 1, 1, 1, 1]));

    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS));
    await waitFor(() => expect(api.requestsTo("GET", READINESS)).toHaveLength(2));
    expect(dependentRequests(api)).toEqual([1, 1, 1, 1, 1]);

    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS));
    await waitFor(() => expect(result.current.data?.in_flight).toBe(false));
    await waitFor(() => expect(dependentRequests(api)).toEqual([2, 2, 2, 2, 2]));
    expect(seen).toEqual([[undefined, BUSY], [BUSY, BUSY], [BUSY, READY]]);

    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS * 5));
    expect(api.requestsTo("GET", READINESS)).toHaveLength(3);
    expect(dependentRequests(api)).toEqual([2, 2, 2, 2, 2]);
  });

  it("an idle first answer neither polls nor refetches the dependent queries", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.reply("GET", READINESS, READY);
    replyDependents(api);
    const { result } = renderHook(() => useOverviewScreen(), { wrapper: wrapperFor(createTestQueryClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS * 3));
    expect(api.requestsTo("GET", READINESS)).toHaveLength(1);
    expect(dependentRequests(api)).toEqual([1, 1, 1, 1, 1]);
  });

  it("a malformed answer fails the contract instead of reaching the cache", async () => {
    api.reply("GET", READINESS, { ...READY, actions: ["bogus"] });
    const { result } = renderHook(() => usePrOverviewReadiness("p1"), { wrapper: wrapperFor(createTestQueryClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not fetch without a PR id", () => {
    renderHook(() => usePrOverviewReadiness(null), { wrapper: wrapperFor(createTestQueryClient()) });
    expect(api.requests).toHaveLength(0);
  });
});

describe("usePrepareOverview", () => {
  const api = setupFakeApi();
  afterEach(() => cleanup());

  it("posts the body, seeds the readiness cache and invalidates intent/risks", async () => {
    api.reply("POST", "/pulls/p1/overview/prepare", { status: "started", started: ["index_full"], failed: [], readiness: BUSY }, 202);
    const qc = createTestQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePrepareOverview("p1"), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync({ reindex_partial: true }));
    expect(api.requestsTo("POST", "/pulls/p1/overview/prepare")[0]?.body).toEqual({ reindex_partial: true });
    expect(qc.getQueryData(overviewReadinessKey("p1"))).toEqual(BUSY);
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([["pr-intent", "p1"], ["pr-risks", "p1"]]);
  });
});

describe("markOverviewIndexRunStarted", () => {
  const api = setupFakeApi();
  afterEach(() => cleanup());

  it("seeds in_flight, so an idle refetch is an in_flight -> idle transition that refetches the blast", async () => {
    api.reply("GET", READINESS, READY);
    replyDependents(api);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useOverviewScreen(), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(api.requestsTo("GET", "/pulls/p1/blast")).toHaveLength(1));

    act(() => markOverviewIndexRunStarted(qc, "p1"));
    await waitFor(() => expect(api.requestsTo("GET", READINESS)).toHaveLength(2));
    await waitFor(() => expect(api.requestsTo("GET", "/pulls/p1/blast")).toHaveLength(2));
  });

  it("is a no-op seed on an empty cache (nothing invented)", () => {
    const qc = createTestQueryClient();
    markOverviewIndexRunStarted(qc, "p1");
    expect(qc.getQueryData(overviewReadinessKey("p1"))).toBeUndefined();
  });
});
