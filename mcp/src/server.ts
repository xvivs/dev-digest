/** Builds the MCP server: five tools plus the server `instructions`. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './deps.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';

export const SERVER_INFO = { name: 'devdigest', version: '0.1.0' } as const;

export const INSTRUCTIONS =
  'DevDigest is a local AI pull-request reviewer. Use these tools to review a PR, read its findings, ' +
  'check a repo\'s coding conventions, or ask about a PR\'s impact. ' +
  'Canonical order to review a PR: list_agents → run_agent_on_pr → get_findings. ' +
  'run_agent_on_pr starts a paid LLM run; to read an existing review, call get_findings directly. ' +
  'Repos are passed as "owner/name" and PRs by number. These tools do not list repos or PRs: ' +
  'use gh (gh pr list --repo owner/name) or the GitHub MCP for that.';

export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerListAgents(server, deps);
  registerRunAgentOnPr(server, deps);
  registerGetFindings(server, deps);
  registerGetConventions(server, deps);
  registerGetBlastRadius(server);
  return server;
}
