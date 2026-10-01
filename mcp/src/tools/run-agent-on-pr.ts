import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../deps.js';
import { ApiError } from '../api/errors.js';
import { waitForRun } from '../poll.js';
import { projectRunResult, severityCounts } from '../project.js';
import { resolveAgent, resolvePr, resolveRepo } from '../resolve.js';
import { ok, toToolResult } from '../results.js';
import { SeverityCountsOutput, prNumberArg, repoArg } from './args.js';

export const RUN_AGENT_ON_PR = 'run_agent_on_pr';

const inputShape = {
  repo: repoArg,
  pr_number: prNumberArg,
  agent: z
    .string()
    .min(1)
    .max(200)
    .describe('Agent id, or agent name (case-insensitive exact match), as returned by list_agents.'),
};

export const RunAgentOnPrOutput = z.object({
  run_id: z.string(),
  status: z.enum(['done', 'running']),
  agent: z.object({ id: z.string(), name: z.string() }),
  repo: z.string(),
  pr_number: z.number().int(),
  duration_ms: z.number().int().nullable(),
  findings_count: z.number().int().nullable(),
  counts_by_severity: SeverityCountsOutput.optional(),
  cost_usd: z.number().nullable().optional(),
  next_step: z.string(),
});
export type RunAgentOnPrOutput = z.infer<typeof RunAgentOnPrOutput>;

const DESCRIPTION =
  'Run a DevDigest review agent on a pull request (start a code review, security review or AI review of a PR). ' +
  'Use it when the user asks DevDigest to review a PR; call list_agents first to pick the agent. ' +
  'Starts exactly one LLM run, which costs money, then waits for it to finish and reports progress. ' +
  'Returns the run_id, finding counts by severity and a next step; call get_findings with that run_id for the findings. ' +
  'If the run takes longer than the wait budget it returns status "running"; call get_findings with the run_id later. ' +
  'Looking up the PR makes DevDigest sync the repo\'s PR list from GitHub.';

export function registerRunAgentOnPr(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    RUN_AGENT_ON_PR,
    {
      title: 'Run a DevDigest agent on a PR',
      description: DESCRIPTION,
      inputSchema: inputShape,
      outputSchema: RunAgentOnPrOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ repo, pr_number, agent }, extra) => {
      try {
        const r = await resolveRepo(deps.api, repo);
        // The agent is resolved (and its `enabled` flag checked) before the PR
        // lookup and long before the POST: no run starts for a bad agent.
        const a = await resolveAgent(deps.api, agent);
        const pr = await resolvePr(deps.api, r, pr_number);

        const started = await deps.api.startReview(pr.id, a.id);
        const target = started.runs.find((x) => x.agent_id === a.id) ?? started.runs[0];
        if (!target) {
          throw new ApiError({
            kind: 'invalid_response',
            message: 'no run returned',
            baseUrl: deps.config.apiUrl,
            endpoint: 'POST /pulls/:id/review',
            timeoutMs: deps.config.httpTimeoutMs,
            issuePath: 'runs',
          });
        }

        const progressToken = extra._meta?.progressToken;
        const outcome = await waitForRun({
          api: deps.api,
          prId: pr.id,
          runId: target.run_id,
          timeoutMs: deps.config.runTimeoutMs,
          intervalMs: deps.config.pollIntervalMs,
          sleep: deps.sleep,
          now: deps.now,
          signal: extra.signal,
          ...(progressToken !== undefined
            ? {
                onProgress: (progress: number) =>
                  extra.sendNotification({
                    method: 'notifications/progress',
                    params: { progressToken, progress, message: `Waiting for run ${target.run_id} (poll ${progress})` },
                  }),
              }
            : {}),
        });

        const base = { runId: target.run_id, agent: { id: a.id, name: a.name }, repo: r.full_name, prNumber: pr.number };
        if (outcome.phase === 'running') return ok<RunAgentOnPrOutput>(projectRunResult(base, null));

        // Counts are a bonus: a failed reviews read or a missing review leaves them out.
        const reviews = await deps.api.listReviews(pr.id, extra.signal).catch(() => null);
        const review = reviews?.find((x) => x.run_id === target.run_id);
        return ok<RunAgentOnPrOutput>(
          projectRunResult(base, outcome.run, review ? severityCounts(review.findings) : undefined),
        );
      } catch (e) {
        return toToolResult(e);
      }
    },
  );
}
