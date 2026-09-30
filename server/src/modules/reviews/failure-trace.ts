import type { RunLogLine, RunTrace } from '@devdigest/shared';
import { estimateTokens } from '@devdigest/reviewer-core';

/** The agent fields a failure trace's `config` / `prompt_assembly` need. */
export interface FailureTraceAgent {
  name: string;
  version: number | string | null;
  provider: string | null;
  model: string | null;
  systemPrompt: string | null;
}

/** A skill resolved for the run (subset of the executor's ResolvedSkill). */
export interface FailureTraceSkill {
  id: string;
  name: string;
  version: number;
  body: string;
  sha256: string;
}

/**
 * A minimal RunTrace whose `log` is the run's buffered events — persisted on
 * failure / cancel / pre-work failure (and by a manual cancel) so the events,
 * and WHY the run stopped, survive a reload and GET /runs/:id/trace resolves
 * once the status is terminal. Pure: callers pass the buffer in.
 */
export function failureTrace(input: {
  agent: FailureTraceAgent;
  prNumber: number | null;
  grounding: string;
  durationMs?: number;
  resolvedSkills?: FailureTraceSkill[];
  log: RunLogLine[];
}): RunTrace {
  const { agent, resolvedSkills } = input;
  // SPEC-02: fill skills_used even on a failure trace WHEN resolution had
  // already happened (pre-work runs before the diff load / the LLM call, so
  // a later failure still has it); absent entirely when it hadn't.
  const skillsUsed =
    resolvedSkills && resolvedSkills.length > 0
      ? resolvedSkills.map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          sha256: s.sha256,
          tokens: estimateTokens(s.body),
        }))
      : null;
  return {
    config: {
      agent: agent.name,
      version: agent.version == null ? null : String(agent.version),
      provider: agent.provider,
      model: agent.model ?? '',
      pr: input.prNumber,
      source: 'local',
    },
    stats: {
      duration_ms: input.durationMs ?? 0,
      tokens_in: 0,
      tokens_out: 0,
      findings: 0,
      grounding: input.grounding,
      cost_usd: null,
      cost_source: null,
      // Only ever built for a failed / cancelled run — never one with a cost.
      cost_missing_reason: 'failed',
    },
    prompt_assembly: {
      system: agent.systemPrompt ?? '',
      skills: null,
      skills_used: skillsUsed,
      skills_tokens: skillsUsed ? skillsUsed.reduce((sum, s) => sum + s.tokens, 0) : null,
      memory: null,
      specs: null,
      user: '',
    },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log: input.log,
  };
}
