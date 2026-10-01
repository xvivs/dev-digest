/** Dependencies every tool handler receives. A leaf module (type-only imports). */
import type { DevDigestApi } from './api/client.js';
import type { McpConfig } from './config.js';
import type { Now, Sleep } from './poll.js';

export interface ToolDeps {
  api: DevDigestApi;
  config: McpConfig;
  sleep: Sleep;
  now: Now;
}
