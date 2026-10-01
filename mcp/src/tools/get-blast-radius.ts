import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { blastRadiusStub } from '../project.js';
import { ok, toToolResult } from '../results.js';
import { prNumberArg, repoArg } from './args.js';

export const GET_BLAST_RADIUS = 'get_blast_radius';

const inputShape = { repo: repoArg, pr_number: prNumberArg };

/** Final shape; the homework wires `GET /pulls/:id/blast` without changing it. */
export const GetBlastRadiusOutput = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable', 'not_implemented']),
  reason: z.string().nullable(),
  repo: z.string(),
  pr_number: z.number().int(),
  summary: z.string().nullable(),
  changed_symbols: z.array(z.object({ name: z.string(), file: z.string(), kind: z.string() })),
  downstream: z.array(
    z.object({
      symbol: z.string(),
      callers_count: z.number().int(),
      top_callers: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int() })),
      endpoints_affected: z.array(z.string()),
      crons_affected: z.array(z.string()),
    }),
  ),
  truncated: z.boolean(),
  next_step: z.string().optional(),
});
export type GetBlastRadiusOutput = z.infer<typeof GetBlastRadiusOutput>;

const DESCRIPTION =
  'Blast radius / impact analysis of a pull request: which changed symbols have downstream callers, endpoints or crons. ' +
  'Use it when the user asks what a PR could break or what it affects. ' +
  'Not wired yet in this build: it always returns status "not_implemented" with empty lists and makes no API call.';

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    GET_BLAST_RADIUS,
    {
      title: 'Get PR blast radius',
      description: DESCRIPTION,
      inputSchema: inputShape,
      outputSchema: GetBlastRadiusOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ repo, pr_number }) => {
      try {
        return ok<GetBlastRadiusOutput>(blastRadiusStub(repo, pr_number));
      } catch (e) {
        return toToolResult(e);
      }
    },
  );
}
