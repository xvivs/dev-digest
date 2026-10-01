/* Spec 08 D11: Resync from a PR screen marks the readiness in flight and refreshes
   the blast; without a PR id only the repo's index state is invalidated. */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { renderHook, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { PrOverviewReadiness } from "@devdigest/shared";
import { createTestQueryClient } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { usePrBlast } from "./brief";
import { overviewReadinessKey, usePrOverviewReadiness } from "./overview";
import { useRepoIntelStatus, useResyncRepoIntel } from "./repo-intel";

const IDLE: PrOverviewReadiness = {
  pr_id: "p1",
  repo_id: "r1",
  clone: { status: "cloned", in_flight: false, last_failure: null },
  index: { status: "partial", in_flight: false, last_indexed_at: null, last_indexed_sha: "abcdef1234", partial_reason: null },
  brief: { intent: "fresh", risks: "fresh", in_flight: false, intent_failure: null, risks_failure: null },
  blocked_by: null,
  actions: [],
  explicit_actions: [],
  in_flight: false,
};

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useResyncRepoIntel", () => {
  const api = setupFakeApi();
  afterEach(() => cleanup());

  /** Live observers of what a resync can change: readiness, blast and the repo's index state. */
  function useObservers() {
    usePrOverviewReadiness("p1");
    usePrBlast("p1");
    useRepoIntelStatus("r1");
  }

  function replyObserved(api: ReturnType<typeof setupFakeApi>) {
    api.reply("POST", "/repos/r1/resync", { status: "queued" }, 202);
    api.reply("GET", "/pulls/p1/overview/readiness", IDLE);
    api.reply("GET", "/pulls/p1/blast", { status: "unavailable", reason: null, source_sha: null, blast: null });
    api.reply("GET", "/repos/r1/index-state", {
      status: "full", filesIndexed: 1, filesSkipped: 0, lastIndexedSha: "abc", updatedAt: "2026-01-01T00:00:00Z",
    });
  }

  it("with prId: posts once, marks readiness in flight and refetches readiness, blast and index state", async () => {
    replyObserved(api);
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => {
        useObservers();
        return useResyncRepoIntel("r1", { prId: "p1" });
      },
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(api.requestsTo("GET", "/pulls/p1/blast")).toHaveLength(1));
    await waitFor(() => expect(api.requestsTo("GET", "/repos/r1/index-state")).toHaveLength(1));
    await waitFor(() => expect(qc.getQueryData(overviewReadinessKey("p1"))).toBeDefined());

    await act(() => result.current.mutateAsync());

    expect(api.requestsTo("POST", "/repos/r1/resync")).toHaveLength(1);
    await waitFor(() => expect(api.requestsTo("GET", "/pulls/p1/overview/readiness")).toHaveLength(2));
    await waitFor(() => expect(api.requestsTo("GET", "/pulls/p1/blast")).toHaveLength(2));
    // The in_flight -> idle readiness transition refetches it once more, so "at least twice".
    await waitFor(() => expect(api.requestsTo("GET", "/repos/r1/index-state").length).toBeGreaterThanOrEqual(2));
  });

  it("with prId: seeds the cached readiness in flight (top-level and index) before the refetch lands", async () => {
    api.reply("POST", "/repos/r1/resync", { status: "queued" }, 202);
    api.route("GET", "/pulls/p1/overview/readiness", () => new Promise<Response>(() => {}));
    const qc = createTestQueryClient();
    qc.setQueryData(overviewReadinessKey("p1"), IDLE);
    const { result } = renderHook(() => useResyncRepoIntel("r1", { prId: "p1" }), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync());

    const seeded = qc.getQueryData<PrOverviewReadiness>(overviewReadinessKey("p1"));
    expect(seeded?.in_flight).toBe(true);
    expect(seeded?.index.in_flight).toBe(true);
  });

  it("without prId: only the index state is refetched; readiness and blast are left alone", async () => {
    replyObserved(api);
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => {
        useObservers();
        return useResyncRepoIntel("r1");
      },
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(api.requestsTo("GET", "/repos/r1/index-state")).toHaveLength(1));
    await waitFor(() => expect(qc.getQueryData(overviewReadinessKey("p1"))).toBeDefined());

    await act(() => result.current.mutateAsync());

    await waitFor(() => expect(api.requestsTo("GET", "/repos/r1/index-state")).toHaveLength(2));
    expect(api.requestsTo("GET", "/pulls/p1/overview/readiness")).toHaveLength(1);
    expect(api.requestsTo("GET", "/pulls/p1/blast")).toHaveLength(1);
    expect(qc.getQueryData(overviewReadinessKey("p1"))).toEqual(IDLE);
  });
});
