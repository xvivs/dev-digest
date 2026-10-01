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
import { OVERVIEW_READINESS_POLL_MS, overviewReadinessKey, usePrepareOverview, usePrOverviewReadiness } from "./overview";

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
const INVALIDATED = [["pr-intent", "p1"], ["pr-risks", "p1"], ["pr-blast", "p1"], ["repo-intel-state", "r1"], ["repos"]];

describe("usePrOverviewReadiness", () => {
  const api = setupFakeApi();
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls every 2 s while in flight; on the idle answer invalidates the five keys once, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [BUSY, BUSY, READY];
    api.route("GET", READINESS, () => json(answers.shift() ?? READY));
    const qc = createTestQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const onReadiness = vi.fn();
    const { result } = renderHook(() => usePrOverviewReadiness("p1", { onReadiness }), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(result.current.data?.in_flight).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS));
    await waitFor(() => expect(api.requestsTo("GET", READINESS)).toHaveLength(2));
    expect(invalidate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS));
    await waitFor(() => expect(result.current.data?.in_flight).toBe(false));
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual(INVALIDATED);
    expect(onReadiness).toHaveBeenCalledTimes(3);
    expect(onReadiness).toHaveBeenLastCalledWith(BUSY, READY);

    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS * 5));
    expect(api.requestsTo("GET", READINESS)).toHaveLength(3);
    expect(invalidate).toHaveBeenCalledTimes(INVALIDATED.length);
  });

  it("an idle first answer neither polls nor invalidates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.reply("GET", READINESS, READY);
    const qc = createTestQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePrOverviewReadiness("p1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(OVERVIEW_READINESS_POLL_MS * 3));
    expect(api.requestsTo("GET", READINESS)).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
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
