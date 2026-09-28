import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/render";

/** Minimal EventSource double: records listeners so a test can push frames. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  close = vi.fn();
  constructor(public path: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(kind: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), fn]);
  }
  emit(kind: string, data: unknown) {
    const ev = new MessageEvent(kind, { data: typeof data === "string" ? data : JSON.stringify(data) });
    for (const fn of this.listeners.get(kind) ?? []) fn(ev);
  }
}

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", () => ({
  openEventStream: (path: string) => new FakeEventSource(path),
  api: { get: (path: string) => get(path), post: (...args: unknown[]) => post(...args) },
}));
const notifyError = vi.fn();
vi.mock("../toast", () => ({ notify: { error: (m: string) => notifyError(m) } }));

import {
  useRunEvents,
  useRunReview,
  useCancelRun,
  useRefreshRunState,
  usePrReviews,
  usePrActiveRuns,
  usePrRuns,
} from "./reviews";

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  get.mockReset();
  post.mockReset();
  notifyError.mockReset();
});
afterEach(cleanup);

describe("useRunEvents", () => {
  it("subscribes one stream per run id", () => {
    renderHook(() => useRunEvents(["r1", "r2"]));
    expect(FakeEventSource.instances.map((es) => es.path)).toEqual([
      "/runs/r1/events",
      "/runs/r2/events",
    ]);
  });

  it("does not subscribe with no run ids", () => {
    const { result } = renderHook(() => useRunEvents([]));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.running).toBe(false);
  });

  it("accumulates parsed events and ignores non-JSON frames", () => {
    const { result } = renderHook(() => useRunEvents(["r1"]));
    const es = FakeEventSource.instances[0]!;
    act(() => {
      es.emit("info", { kind: "info", msg: "started" });
      es.emit("tool", "keepalive");
      es.emit("result", { kind: "result", msg: "done" });
    });
    expect(result.current.events.map((e) => e.msg)).toEqual(["started", "done"]);
    expect(result.current.running).toBe(true);
  });

  it("toasts a runtime error event", () => {
    renderHook(() => useRunEvents(["r1"]));
    act(() => FakeEventSource.instances[0]!.emit("error", { kind: "error", msg: "model timed out" }));
    expect(notifyError).toHaveBeenCalledWith("model timed out");
  });

  it("stays running until every stream has errored/closed", () => {
    const { result } = renderHook(() => useRunEvents(["r1", "r2"]));
    const [a, b] = FakeEventSource.instances;
    act(() => a!.onerror?.());
    expect(a!.close).toHaveBeenCalled();
    expect(result.current.running).toBe(true);
    act(() => b!.onerror?.());
    expect(result.current.running).toBe(false);
  });

  it("closes every stream on unmount", () => {
    const { unmount } = renderHook(() => useRunEvents(["r1", "r2"]));
    unmount();
    for (const es of FakeEventSource.instances) expect(es.close).toHaveBeenCalled();
  });
});

describe("run mutations invalidate the PR's run state", () => {
  /** GET calls seen so far for one endpoint — the user-visible effect of an
   *  invalidated query is a refetch, so count network calls instead of
   *  spying on `invalidateQueries`. */
  const gets = (path: string) => get.mock.calls.filter(([p]) => p === path).length;

  it("useRunReview refetches reviews, active runs and run history", async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValue({ runs: [] });
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        reviews: usePrReviews("pr1"),
        active: usePrActiveRuns("pr1"),
        runs: usePrRuns("pr1"),
        mutation: useRunReview(),
      }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(gets("/pulls/pr1/reviews")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(1));

    await act(() => result.current.mutation.mutateAsync({ prId: "pr1", all: true }));

    await waitFor(() => expect(gets("/pulls/pr1/reviews")).toBe(2));
    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(2));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(2));
  });

  it("useCancelRun(prId) refetches active runs and history even when the request fails, but leaves reviews alone", async () => {
    get.mockResolvedValue([]);
    post.mockRejectedValue(new Error("gone"));
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        reviews: usePrReviews("pr1"),
        active: usePrActiveRuns("pr1"),
        runs: usePrRuns("pr1"),
        mutation: useCancelRun("pr1"),
      }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(gets("/pulls/pr1/reviews")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(1));

    act(() => result.current.mutation.mutate("run1"));
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));

    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(2));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(2));
    expect(gets("/pulls/pr1/reviews")).toBe(1);
  });

  it("useCancelRun() without a prId invalidates nothing", async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValue({ ok: true });
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        active: usePrActiveRuns("pr1"),
        runs: usePrRuns("pr1"),
        mutation: useCancelRun(),
      }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(1));

    await act(() => result.current.mutation.mutateAsync("run1"));

    expect(gets("/pulls/pr1/runs/active")).toBe(1);
    expect(gets("/pulls/pr1/runs")).toBe(1);
  });

  it("useRefreshRunState refetches all three, and is a no-op without a prId", async () => {
    get.mockResolvedValue([]);
    const qc = createTestQueryClient();
    const { result, rerender } = renderHook(
      ({ prId }: { prId: string | null }) => ({
        reviews: usePrReviews(prId),
        active: usePrActiveRuns(prId),
        runs: usePrRuns(prId),
        refresh: useRefreshRunState(prId),
      }),
      { wrapper: wrapperFor(qc), initialProps: { prId: null as string | null } },
    );

    result.current.refresh();
    expect(gets("/pulls/pr1/runs/active")).toBe(0);

    rerender({ prId: "pr1" });
    await waitFor(() => expect(gets("/pulls/pr1/reviews")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(1));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(1));

    await act(() => result.current.refresh());

    await waitFor(() => expect(gets("/pulls/pr1/reviews")).toBe(2));
    await waitFor(() => expect(gets("/pulls/pr1/runs/active")).toBe(2));
    await waitFor(() => expect(gets("/pulls/pr1/runs")).toBe(2));
  });
});
