import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { apiFetch, api, ApiError, API_BASE, openEventStream } from "./api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function headersOf(fn: ReturnType<typeof mockFetch>): Record<string, string> {
  const init = fn.mock.calls[0]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("turns a network failure into ApiError with status 0", async () => {
    const cause = new TypeError("Failed to fetch");
    mockFetch(() => Promise.reject(cause));
    const err = await apiFetch("/repos").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "network_error", details: cause });
  });

  it("reads code, message and details from a JSON error body", async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "not_found", message: "No such PR", details: { id: "x" } } },
          { status: 404, statusText: "Not Found" },
        ),
      ),
    );
    const err = await apiFetch("/pulls/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "No such PR", details: { id: "x" } });
  });

  it("falls back to the status line for a non-JSON error body", async () => {
    mockFetch(() =>
      Promise.resolve(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" })),
    );
    const err = await apiFetch("/repos").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: undefined, message: "502 Bad Gateway" });
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(apiFetch<void>("/runs/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("sets content-type only when a body is sent", async () => {
    const withBody = mockFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    await api.post("/repos", { url: "https://github.com/a/b" });
    expect(headersOf(withBody)["content-type"]).toBe("application/json");

    const noBody = mockFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    await api.post("/repos/1/refresh");
    expect(headersOf(noBody)).not.toHaveProperty("content-type");
  });

  it("prefixes the path with API_BASE", async () => {
    const fn = mockFetch(() => Promise.resolve(jsonResponse([])));
    await api.get("/repos");
    expect(fn.mock.calls[0]?.[0]).toBe(`${API_BASE}/repos`);
  });

  describe("with a response schema (validated outside production)", () => {
    const Repo = z.object({ id: z.string(), stars: z.number().default(0) });

    it("returns the parsed body, defaults applied", async () => {
      mockFetch(() => Promise.resolve(jsonResponse({ id: "r1" })));
      await expect(api.get("/repos/r1", Repo)).resolves.toEqual({ id: "r1", stars: 0 });
    });

    it("throws ApiError invalid_response when the body breaks the contract", async () => {
      mockFetch(() => Promise.resolve(jsonResponse({ id: 42 })));
      const err = await api.get("/repos/r1", Repo).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 200, code: "invalid_response" });
      expect((err as ApiError).details).toEqual([
        expect.objectContaining({ path: ["id"], code: "invalid_type" }),
      ]);
    });

    it("skips validation in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        mockFetch(() => Promise.resolve(jsonResponse({ id: 42 })));
        await expect(api.get("/repos/r1", Repo)).resolves.toEqual({ id: 42 });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

describe("openEventStream", () => {
  it("opens an EventSource on API_BASE + path", () => {
    const ctor = vi.fn();
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          ctor(url);
        }
      },
    );
    openEventStream("/runs/r1/events");
    expect(ctor).toHaveBeenCalledWith(`${API_BASE}/runs/r1/events`);
  });
});
