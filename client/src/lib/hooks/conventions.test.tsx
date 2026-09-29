/**
 * Conventions hooks — real `api` over a faked `fetch`, so the zod contracts
 * (ADR 0007) run too. Covers the parts the screens lean on: polling only while
 * a scan runs, attaching to a running scan without an error (AC-41), the
 * optimistic decision that a refetch cannot overwrite (AC-36), and the error
 * surface of each mutation (ADR 0011).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ConventionsPage } from "@devdigest/shared";
import { candidate, page, scan } from "@/app/repos/[repoId]/conventions/fixtures";
import { createQueryClient } from "../query-client";

const notifyError = vi.fn();
vi.mock("../toast", () => ({ notify: { error: (m: string) => notifyError(m) } }));

import {
  runningScanId,
  useConventions,
  useCreateSkillFromConventions,
  useExtractConventions,
  useUpdateConvention,
} from "./conventions";
import { ApiError } from "../api";

type Handler = (init?: RequestInit) => Response | Promise<Response>;
const routes = new Map<string, Handler>();
const calls: { method: string; path: string; body: unknown }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function apiError(status: number, code: string, details?: unknown): Response {
  return json({ error: { code, message: code, details } }, status);
}
function route(method: string, path: string, handler: Handler) {
  routes.set(`${method} ${path}`, handler);
}

function makeClient(): QueryClient {
  const qc = createQueryClient(() => "fallback");
  qc.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: 0 }, mutations: { retry: false } });
  return qc;
}
function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  routes.clear();
  calls.length = 0;
  notifyError.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      calls.push({ method, path: url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const handler = routes.get(`${method} ${url}`);
      if (!handler) return apiError(404, "no_route", `${method} ${url}`);
      return handler(init);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const KEY = ["conventions", "repo-1"] as const;

describe("useConventions", () => {
  it("returns the page and validates it against the contract", async () => {
    route("GET", "/repos/repo-1/conventions", () => json(page({ candidates: [candidate("a")] })));
    const { result } = renderHook(() => useConventions("repo-1"), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.candidates[0]?.id).toBe("a");
  });

  it("fails loudly when the server breaks the contract", async () => {
    route("GET", "/repos/repo-1/conventions", () => json({ candidates: "nope" }));
    const { result } = renderHook(() => useConventions("repo-1"), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "invalid_response" });
  });

  it("does not fetch without a repo id", () => {
    renderHook(() => useConventions(undefined), { wrapper: wrapperFor(makeClient()) });
    expect(calls).toHaveLength(0);
  });

  it("polls while a scan runs and stops once it finishes", async () => {
    vi.useFakeTimers();
    const pages = [
      page({ running_scan: scan({ status: "running", finished_at: null }) }),
      page({ running_scan: scan({ status: "running", finished_at: null }) }),
      page(),
    ];
    let n = 0;
    route("GET", "/repos/repo-1/conventions", () => json(pages[Math.min(n++, pages.length - 1)]));
    renderHook(() => useConventions("repo-1"), { wrapper: wrapperFor(makeClient()) });

    const flush = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await flush(0);
    expect(n).toBe(1);
    await flush(2000);
    expect(n).toBe(2);
    await flush(2000);
    expect(n).toBe(3); // this response has no running scan
    await flush(10_000);
    expect(n).toBe(3); // ...so the polling stopped
  });

  it("never polls a page with no running scan", async () => {
    vi.useFakeTimers();
    let n = 0;
    route("GET", "/repos/repo-1/conventions", () => { n++; return json(page()); });
    renderHook(() => useConventions("repo-1"), { wrapper: wrapperFor(makeClient()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(n).toBe(1);
  });
});

describe("runningScanId", () => {
  it("reads the winner's scan id from a 409 scan_running", () => {
    expect(runningScanId(new ApiError("x", 409, "scan_running", { scan_id: "s9" }))).toBe("s9");
  });

  it.each([
    ["another 409", new ApiError("x", 409, "repo_not_indexed", { scan_id: "s9" })],
    ["another status", new ApiError("x", 500, "scan_running", { scan_id: "s9" })],
    ["missing details", new ApiError("x", 409, "scan_running")],
    ["a non-string id", new ApiError("x", 409, "scan_running", { scan_id: 4 })],
    ["a plain error", new Error("x")],
  ])("is null for %s", (_label, err) => {
    expect(runningScanId(err)).toBeNull();
  });
});

describe("useExtractConventions", () => {
  it("starts a scan and refreshes the page", async () => {
    route("POST", "/repos/repo-1/conventions/extract", () => json({ scan_id: "s1" }, 202));
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useExtractConventions("repo-1"), { wrapper: wrapperFor(qc) });
    let out: unknown;
    await act(async () => { out = await result.current.mutateAsync(); });
    expect(out).toEqual({ scan_id: "s1", attached: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it("attaches to the running scan on a 409, with no error and no toast (AC-41)", async () => {
    route("POST", "/repos/repo-1/conventions/extract", () => apiError(409, "scan_running", { scan_id: "s-winner" }));
    const { result } = renderHook(() => useExtractConventions("repo-1"), { wrapper: wrapperFor(makeClient()) });
    let out: unknown;
    await act(async () => { out = await result.current.mutateAsync(); });
    expect(out).toEqual({ scan_id: "s-winner", attached: true });
    expect(result.current.isError).toBe(false);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("lets a blocked repo through as an error, silently when the caller owns it", async () => {
    route("POST", "/repos/repo-1/conventions/extract", () => apiError(409, "repo_not_indexed"));
    const { result } = renderHook(
      () => useExtractConventions("repo-1", { meta: { errorSurface: "local" } }),
      { wrapper: wrapperFor(makeClient()) },
    );
    await act(async () => { await result.current.mutateAsync().catch(() => {}); });
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 409, code: "repo_not_indexed" }));
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("toasts a failure only when the caller did not opt into a local surface", async () => {
    route("POST", "/repos/repo-1/conventions/extract", () => apiError(500, "boom"));
    const { result } = renderHook(() => useExtractConventions("repo-1"), { wrapper: wrapperFor(makeClient()) });
    await act(async () => { await result.current.mutateAsync().catch(() => {}); });
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});

describe("useUpdateConvention (AC-36, AC-37)", () => {
  const seed = (qc: QueryClient) =>
    qc.setQueryData<ConventionsPage>(KEY, page({ candidates: [candidate("a"), candidate("b")] }));
  const statusOf = (qc: QueryClient, id: string) =>
    qc.getQueryData<ConventionsPage>(KEY)?.candidates.find((c) => c.id === id)?.status;

  it("moves the card at once, before the server answers", async () => {
    let release: (r: Response) => void = () => {};
    route("PATCH", "/conventions/a", () => new Promise<Response>((res) => { release = res; }));
    const qc = makeClient();
    seed(qc);
    const { result } = renderHook(() => useUpdateConvention("repo-1"), { wrapper: wrapperFor(qc) });

    act(() => result.current.mutate({ id: "a", patch: { status: "accepted" } }));
    await waitFor(() => expect(statusOf(qc, "a")).toBe("accepted"));
    expect(statusOf(qc, "b")).toBe("pending");
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/conventions/a", body: { status: "accepted" } });

    route("GET", "/repos/repo-1/conventions", () => json(page({ candidates: [candidate("a", { status: "accepted" }), candidate("b")] })));
    await act(async () => { release(json(candidate("a", { status: "accepted" }))); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(statusOf(qc, "a")).toBe("accepted");
  });

  it("rolls back and toasts when the request fails", async () => {
    route("PATCH", "/conventions/a", () => apiError(500, "boom"));
    const qc = makeClient();
    seed(qc);
    route("GET", "/repos/repo-1/conventions", () => json(page({ candidates: [candidate("a"), candidate("b")] })));
    const { result } = renderHook(() => useUpdateConvention("repo-1"), { wrapper: wrapperFor(qc) });
    await act(async () => { await result.current.mutateAsync({ id: "a", patch: { status: "rejected" } }).catch(() => {}); });
    expect(statusOf(qc, "a")).toBe("pending");
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("marks an edited rule as edited straight away, and keeps the server's version after", async () => {
    route("PATCH", "/conventions/a", () =>
      json(candidate("a", { rule: "A fresh rule for the team", edited: true, category: "typing" })),
    );
    route("GET", "/repos/repo-1/conventions", () => json(page({ candidates: [candidate("a", { rule: "A fresh rule for the team", edited: true, category: "typing" }), candidate("b")] })));
    const qc = makeClient();
    seed(qc);
    const { result } = renderHook(() => useUpdateConvention("repo-1"), { wrapper: wrapperFor(qc) });
    act(() => result.current.mutate({ id: "a", patch: { rule: "A fresh rule for the team", category: "typing" } }));
    await waitFor(() => {
      const a = qc.getQueryData<ConventionsPage>(KEY)?.candidates.find((c) => c.id === "a");
      expect(a).toMatchObject({ rule: "A fresh rule for the team", edited: true, category: "typing" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("is not overwritten by a refetch that was already in flight (cancelQueries)", async () => {
    let resolveStale: (r: Response) => void = () => {};
    route("GET", "/repos/repo-1/conventions", () => new Promise<Response>((res) => { resolveStale = res; }));
    let resolvePatch: (r: Response) => void = () => {};
    route("PATCH", "/conventions/a", () => new Promise<Response>((res) => { resolvePatch = res; }));
    const qc = makeClient();
    seed(qc);
    const { result } = renderHook(
      () => ({ query: useConventions("repo-1"), update: useUpdateConvention("repo-1") }),
      { wrapper: wrapperFor(qc) },
    );
    // a poll or refetch is on the wire with the OLD state...
    act(() => { void qc.refetchQueries({ queryKey: KEY }); });
    await waitFor(() => expect(result.current.query.isFetching).toBe(true));
    // ...then the person accepts a card.
    act(() => result.current.update.mutate({ id: "a", patch: { status: "accepted" } }));
    await waitFor(() => expect(statusOf(qc, "a")).toBe("accepted"));
    // The stale response arrives late and must not win.
    await act(async () => { resolveStale(json(page({ candidates: [candidate("a"), candidate("b")] }))); });
    expect(statusOf(qc, "a")).toBe("accepted");
    await act(async () => { resolvePatch(json(candidate("a", { status: "accepted" }))); });
  });
});

describe("useCreateSkillFromConventions", () => {
  const body = { name: "s", body: "# s", enabled: true, convention_ids: ["a"], agent_ids: ["ag1"] };
  const skill = { id: "sk1", name: "s", description: "", type: "convention", source: "extracted", body: "# s", enabled: true, version: 1, needs_vetting: false };

  it("posts the payload and refreshes skills, agents, agent-skills and conventions", async () => {
    route("POST", "/repos/repo-1/conventions/skills", () => json({ skill, linked_agent_ids: ["ag1"] }, 201));
    const qc = makeClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateSkillFromConventions("repo-1"), { wrapper: wrapperFor(qc) });
    let out: unknown;
    await act(async () => { out = await result.current.mutateAsync(body); });
    expect(out).toMatchObject({ skill: { id: "sk1" }, linked_agent_ids: ["ag1"] });
    expect(calls.at(-1)?.body).toEqual(body);
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["skills", "agents", "agent-skills", "conventions"]));
  });

  it("surfaces a 409 to the caller and stays silent when local", async () => {
    route("POST", "/repos/repo-1/conventions/skills", () => apiError(409, "skill_name_taken"));
    const { result } = renderHook(
      () => useCreateSkillFromConventions("repo-1", { meta: { errorSurface: "local" } }),
      { wrapper: wrapperFor(makeClient()) },
    );
    const err = await act(async () => result.current.mutateAsync(body).catch((e: unknown) => e));
    expect(err).toMatchObject({ status: 409, code: "skill_name_taken" });
    expect(notifyError).not.toHaveBeenCalled();
  });
});
