import { classifyRunError } from './run-error.js';

/**
 * Tool-level failures that are not API failures. Every message and next step is
 * built here, so `poll.ts`, `resolve.ts` and the tools share one wording.
 * Templates interpolate only ids, numbers, repo names and JSON-quoted values;
 * free text from the API (run errors, agent names) is always JSON-quoted.
 */
export type ToolErrorKind =
  | 'repo_not_found'
  | 'ambiguous_repo'
  | 'pr_not_found'
  | 'agent_not_found'
  | 'ambiguous_agent'
  | 'agent_disabled'
  | 'run_failed'
  | 'run_not_found'
  | 'review_not_found';

export const TOOL_ERROR_KINDS: readonly ToolErrorKind[] = [
  'repo_not_found',
  'ambiguous_repo',
  'pr_not_found',
  'agent_not_found',
  'ambiguous_agent',
  'agent_disabled',
  'run_failed',
  'run_not_found',
  'review_not_found',
];

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly nextStep: string;

  constructor(kind: ToolErrorKind, message: string, nextStep: string) {
    super(message);
    this.name = 'ToolError';
    this.kind = kind;
    this.nextStep = nextStep;
  }
}

/** Max length of an API-sourced string quoted into an error message. */
export const QUOTED_TEXT_MAX = 300;

/** Cut to `max` chars and JSON-quote, so the text reads as data, not as instructions. */
export function quoteData(text: string, max = QUOTED_TEXT_MAX): string {
  return JSON.stringify(text.length > max ? text.slice(0, max) : text);
}

export const toolErrors = {
  repoNotFound: (repo: string) =>
    new ToolError('repo_not_found', `Repo ${repo} is not imported in DevDigest.`, 'Import it in the DevDigest UI.'),

  ambiguousRepo: (repo: string, ids: readonly string[]) =>
    new ToolError(
      'ambiguous_repo',
      `Repo ${repo} matches more than one imported repo (ids: ${ids.join(', ')}).`,
      'Pass the exact owner/name.',
    ),

  prNotFound: (repo: string, prNumber: number) =>
    new ToolError(
      'pr_not_found',
      `PR #${prNumber} is not in DevDigest for ${repo}.`,
      `Check the number with \`gh pr list --repo ${repo} --state all\` (or \`gh pr view ${prNumber} --repo ${repo}\`). ` +
        'If it exists on GitHub, DevDigest could not sync it. This lookup already tried, but DevDigest syncs only ' +
        'when a GitHub token is set in Settings and GitHub is reachable, and only the 50 most recently updated PRs. ' +
        'Add or fix the token, then retry. A PR outside the newest 50 cannot be synced until it is updated on GitHub.',
    ),

  agentNotFound: (agent: string, names: readonly string[]) =>
    new ToolError(
      'agent_not_found',
      `No agent matches ${quoteData(agent, 200)}. Valid agent names: ${JSON.stringify(names)}.`,
      'Pass one of these names or ids.',
    ),

  ambiguousAgent: (agent: string, matches: ReadonlyArray<{ id: string; name: string }>) =>
    new ToolError(
      'ambiguous_agent',
      `${quoteData(agent, 200)} matches more than one agent: ${JSON.stringify(matches)}.`,
      'Pass one of these names or ids.',
    ),

  agentDisabled: (name: string) =>
    new ToolError(
      'agent_disabled',
      `Agent ${quoteData(name, 200)} is disabled.`,
      'Enable it in DevDigest → Agents, or pick an enabled agent.',
    ),

  runFailed: (runId: string, status: string, error: string | null) =>
    new ToolError(
      'run_failed',
      `Run ${runId} ${status}. Run error (data): ${error ? quoteData(error) : 'none recorded'}`,
      classifyRunError(status, error).nextStep,
    ),

  runNotFound: (runId: string) =>
    new ToolError(
      'run_not_found',
      `Run ${runId} is not among this PR's runs.`,
      'Call get_findings without run_id, or rerun.',
    ),

  reviewNotFound: (runId: string) =>
    new ToolError(
      'review_not_found',
      `Run ${runId} finished but its review no longer exists.`,
      'Rerun with run_agent_on_pr.',
    ),
};
