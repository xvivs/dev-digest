/**
 * devdigest-mcp entrypoint: config → DevDigestApi → MCP server → stdio.
 * stdout carries MCP frames only; every log line goes to stderr. API
 * reachability is checked per tool call, never at startup.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpDevDigestApi } from './api/client.js';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { realSleep } from './poll.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new HttpDevDigestApi(config.apiUrl, config.httpTimeoutMs);
  const server = buildServer({ api, config, sleep: realSleep, now: () => Date.now() });
  await server.connect(new StdioServerTransport());
  log.info('ready on stdio', { api: config.apiUrl });
}

main().catch((err: unknown) => {
  log.error('failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
