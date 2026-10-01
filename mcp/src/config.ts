import { z } from 'zod';

export interface McpConfig {
  /** DevDigest API origin, e.g. http://127.0.0.1:3001 (a path part is dropped by `new URL`). */
  readonly apiUrl: string;
  /** How long `run_agent_on_pr` polls before returning `status: 'running'` (D9). */
  readonly runTimeoutMs: number;
  /** Delay between run polls (D9). */
  readonly pollIntervalMs: number;
  /** Per-request HTTP timeout (D8). */
  readonly httpTimeoutMs: number;
}

const HttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:$/.test(new URL(u).protocol), 'must be an http(s) URL');

const PositiveInt = z.coerce.number().int().positive();

const Env = z.object({
  DEVDIGEST_API_URL: HttpUrl.default('http://127.0.0.1:3001'),
  DEVDIGEST_MCP_RUN_TIMEOUT_MS: PositiveInt.default(600_000),
  DEVDIGEST_MCP_POLL_INTERVAL_MS: PositiveInt.default(2_000),
  DEVDIGEST_MCP_HTTP_TIMEOUT_MS: PositiveInt.default(180_000),
});

/** env → frozen config. Throws a ZodError on an invalid value. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  // Treat empty strings as unset, so `DEVDIGEST_API_URL=` falls back to the default.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const e = Env.parse(present);
  return Object.freeze({
    apiUrl: e.DEVDIGEST_API_URL,
    runTimeoutMs: e.DEVDIGEST_MCP_RUN_TIMEOUT_MS,
    pollIntervalMs: e.DEVDIGEST_MCP_POLL_INTERVAL_MS,
    httpTimeoutMs: e.DEVDIGEST_MCP_HTTP_TIMEOUT_MS,
  });
}
