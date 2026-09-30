/* fake-api.ts — a faked `fetch` for tests that run the real `api` client and hooks.
   Mock the network, not our own hooks: the zod contracts, query cache, polling and
   error mapping then run exactly as in the app. Routes match `METHOD /path`, where a
   `:name` segment captures a value (`PATCH /conventions/:id`). Anything unmatched
   answers 404 `no_route`, so a forgotten route fails loudly instead of hanging. */
import { afterEach, beforeEach, vi } from "vitest";

export interface FakeRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
}
export type FakeHandler = (req: FakeRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The server's error envelope (`{ error: { code, message, details } }`). */
export function apiError(status: number, code: string, message = code, details?: unknown): Response {
  return json({ error: { code, message, details } }, status);
}

export interface FakeApi {
  /** Registers (or replaces) the handler of one route. */
  route(method: string, path: string, handler: FakeHandler): void;
  /** Shorthand: a route that always answers `body` with `status`. */
  reply(method: string, path: string, body: unknown, status?: number): void;
  /** Every request made since the last reset, in order. */
  requests: FakeRequest[];
  /** The requests to one route, e.g. `api.requestsTo("POST", "/repos/repo-1/resync")`. */
  requestsTo(method: string, path: string): FakeRequest[];
}

interface Route {
  method: string;
  segments: string[];
  handler: FakeHandler;
}

function match(route: Route, method: string, path: string): Record<string, string> | null {
  if (route.method !== method) return null;
  const parts = path.split("/");
  if (parts.length !== route.segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const want = route.segments[i] ?? "";
    const got = parts[i] ?? "";
    if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(got);
    else if (want !== got) return null;
  }
  return params;
}

/**
 * Installs the fake `fetch` before each test and removes it after. Call once at
 * the top of a test file's `describe` scope; routes are cleared between tests.
 */
export function setupFakeApi(): FakeApi {
  let routes: Route[] = [];
  const api: FakeApi = {
    requests: [],
    route(method, path, handler) {
      const segments = path.split("/");
      routes = [...routes.filter((r) => !(r.method === method && r.segments.join("/") === path)), { method, segments, handler }];
    },
    reply(method, path, body, status = 200) {
      api.route(method, path, () => json(body, status));
    },
    requestsTo(method, path) {
      return api.requests.filter((r) => r.method === method && r.path === path);
    },
  };

  beforeEach(() => {
    routes = [];
    api.requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).replace(/^https?:\/\/[^/]+/, "");
        const method = init?.method ?? "GET";
        const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
        for (const r of routes) {
          const params = match(r, method, path);
          if (params) {
            const req = { method, path, params, body };
            api.requests.push(req);
            return r.handler(req);
          }
        }
        api.requests.push({ method, path, params: {}, body });
        return apiError(404, "no_route", `${method} ${path}`);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return api;
}
