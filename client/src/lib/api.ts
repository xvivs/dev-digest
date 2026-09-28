/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`, and every live stream on `openEventStream`:
   this file is the only transport in the client. Errors are normalized to
   ApiError so the error-UX taxonomy (toast/inline/full-screen) can branch on status. */
import type { ZodType, ZodTypeDef } from "zod";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

/** `ApiError.status` for a request that never got a response (API down, CORS, DNS). */
export const NETWORK_ERROR_STATUS = 0;
/** `ApiError.code` values raised by the client itself (not by the server). */
export const CLIENT_ERROR_CODE = {
  network: "network_error",
  invalidResponse: "invalid_response",
} as const;

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * A zod schema whose parsed output is `T`. Input is `unknown` so schemas with
 * `.default()` / `.transform()` (input ≠ output) are accepted too.
 * Imported as a type only: `api.ts` adds no zod code to the bundle.
 */
export type ResponseSchema<T> = ZodType<T, ZodTypeDef, unknown>;

/**
 * Response validation runs in dev and test only (docs/adr/0007-api-response-validation.md).
 * Production keeps the plain cast, so a large payload costs no parse and an
 * additive server change cannot break the UI.
 */
function shouldValidate(): boolean {
  return process.env.NODE_ENV !== "production";
}

interface ServerErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

function isServerErrorBody(v: unknown): v is ServerErrorBody {
  return typeof v === "object" && v !== null && "error" in v;
}

/**
 * @param schema optional contract for the response body. When given (and not
 *   in production), a body that fails to parse throws
 *   `ApiError(status = res.status, code = "invalid_response", details = zod issues)`.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  schema?: ResponseSchema<T>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      NETWORK_ERROR_STATUS,
      CLIENT_ERROR_CODE.network,
      e,
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body: unknown = await res.json();
      if (isServerErrorBody(body) && body.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  // 204 carries no body. Callers of a 204 endpoint type T as void/undefined.
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json();

  if (schema && shouldValidate()) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        `Response from ${path} does not match its contract: ${parsed.error.message}`,
        res.status,
        CLIENT_ERROR_CODE.invalidResponse,
        parsed.error.issues,
      );
    }
    return parsed.data;
  }
  return body as T;
}

const jsonBody = (body: unknown) => (body ? JSON.stringify(body) : undefined);

export const api = {
  get: <T>(path: string, schema?: ResponseSchema<T>) => apiFetch<T>(path, undefined, schema),
  post: <T>(path: string, body?: unknown, schema?: ResponseSchema<T>) =>
    apiFetch<T>(path, { method: "POST", body: jsonBody(body) }, schema),
  put: <T>(path: string, body?: unknown, schema?: ResponseSchema<T>) =>
    apiFetch<T>(path, { method: "PUT", body: jsonBody(body) }, schema),
  patch: <T>(path: string, body?: unknown, schema?: ResponseSchema<T>) =>
    apiFetch<T>(path, { method: "PATCH", body: jsonBody(body) }, schema),
  del: <T>(path: string, schema?: ResponseSchema<T>) =>
    apiFetch<T>(path, { method: "DELETE" }, schema),
};

/**
 * Open a Server-Sent Events stream on the API (e.g. `/runs/:id/events`).
 * The caller owns the returned EventSource and must `close()` it.
 */
export function openEventStream(path: string): EventSource {
  return new EventSource(`${API_BASE}${path}`);
}
