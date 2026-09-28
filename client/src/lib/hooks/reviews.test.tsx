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

const post = vi.fn();
vi.mock("../api", () => ({
  openEventStream: (path: string) => new FakeEventSource(path),
  api: { post: (...args: unknown[]) => post(...args) },
}));
const notifyError = vi.fn();
vi.mock("../toast", () => ({ notify: { error: (m: string) => notifyError(m) } }));

import { useRunEvents, useRunReview, useCancelRun, useRefreshRunState } from "./reviews";

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
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
  function invalidatedKeys(qc: QueryClient) {
    const spy = vi.spyOn(qc, "invalidateQueries");
    return () => spy.mock.calls.map(([filters]) => filters?.queryKey);
  }

  it("useRunReview refetches reviews, active runs and run history", async () => {
    post.mockResolvedValue({ runs: [] });
    const qc = createTestQueryClient();
    const keys = invalidatedKeys(qc);
    const { result } = renderHook(() => useRunReview(), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync({ prId: "pr1", all: true }));
    expect(keys()).toEqual([
      ["reviews", "pr1"],
      ["pr-active-runs", "pr1"],
      ["pr-runs", "pr1"],
    ]);
  });

  it("useCancelRun(prId) refetches active runs and history even when the request fails", async () => {
    post.mockRejectedValue(new Error("gone"));
    const qc = createTestQueryClient();
    const keys = invalidatedKeys(qc);
    const { result } = renderHook(() => useCancelRun("pr1"), { wrapper: wrapperFor(qc) });
    act(() => result.current.mutate("run1"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys()).toEqual([
      ["pr-active-runs", "pr1"],
      ["pr-runs", "pr1"],
    ]);
  });

  it("useCancelRun() without a prId invalidates nothing", async () => {
    post.mockResolvedValue({ ok: true });
    const qc = createTestQueryClient();
    const keys = invalidatedKeys(qc);
    const { result } = renderHook(() => useCancelRun(), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync("run1"));
    expect(keys()).toEqual([]);
  });

  it("useRefreshRunState refetches all three, and is a no-op without a prId", () => {
    const qc = createTestQueryClient();
    const keys = invalidatedKeys(qc);
    const { result, rerender } = renderHook(({ prId }) => useRefreshRunState(prId), {
      wrapper: wrapperFor(qc),
      initialProps: { prId: null as string | null },
    });
    result.current();
    expect(keys()).toEqual([]);
    rerender({ prId: "pr1" });
    result.current();
    expect(keys()).toEqual([
      ["pr-active-runs", "pr1"],
      ["pr-runs", "pr1"],
      ["reviews", "pr1"],
    ]);
  });
});
