/* Spec 08 D11: Resync from a PR screen marks the readiness in flight and refreshes
   the blast; without a PR id only the repo's index state is invalidated. */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, cleanup, act } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { PrOverviewReadiness } from "@devdigest/shared";
import { createTestQueryClient } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { overviewReadinessKey } from "./overview";
import { useResyncRepoIntel } from "./repo-intel";

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

  it("with prId: posts once, marks readiness in flight (top-level and index), invalidates readiness, pr-blast and repo-intel-state", async () => {
    api.reply("POST", "/repos/r1/resync", { status: "queued" }, 202);
    const qc = createTestQueryClient();
    qc.setQueryData(overviewReadinessKey("p1"), IDLE);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useResyncRepoIntel("r1", { prId: "p1" }), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync());

    expect(api.requestsTo("POST", "/repos/r1/resync")).toHaveLength(1);
    const seeded = qc.getQueryData<PrOverviewReadiness>(overviewReadinessKey("p1"));
    expect(seeded?.in_flight).toBe(true);
    expect(seeded?.index.in_flight).toBe(true);
    const keys = invalidate.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toContainEqual(["repo-intel-state", "r1"]);
    expect(keys).toContainEqual(overviewReadinessKey("p1"));
    expect(keys).toContainEqual(["pr-blast", "p1"]);
  });

  it("without prId: only repo-intel-state is invalidated and the readiness cache is untouched", async () => {
    api.reply("POST", "/repos/r1/resync", { status: "queued" }, 202);
    const qc = createTestQueryClient();
    qc.setQueryData(overviewReadinessKey("p1"), IDLE);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useResyncRepoIntel("r1"), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync());

    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([["repo-intel-state", "r1"]]);
    expect(qc.getQueryData(overviewReadinessKey("p1"))).toEqual(IDLE);
  });
});
