import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../deps.js';
import { projectAgents } from '../project.js';
import { ok, toToolResult } from '../results.js';

export const LIST_AGENTS = 'list_agents';

export const ListAgentsOutput = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      model: z.string(),
      enabled: z.boolean(),
    }),
  ),
});
export type ListAgentsOutput = z.infer<typeof ListAgentsOutput>;

const DESCRIPTION =
  'List the DevDigest review agents (reviewers, AI code reviewers) that can run on a pull request. ' +
  'Use it before run_agent_on_pr to pick an agent by name or id, or when the user asks which reviewers exist. ' +
  'Returns id, name, description, model and whether each agent is enabled, sorted by name. ' +
  'Only enabled agents can be run.';

export function registerListAgents(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    LIST_AGENTS,
    {
      title: 'List DevDigest agents',
      description: DESCRIPTION,
      inputSchema: {},
      outputSchema: ListAgentsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok<ListAgentsOutput>(projectAgents(await deps.api.listAgents()));
      } catch (e) {
        return toToolResult(e);
      }
    },
  );
}
