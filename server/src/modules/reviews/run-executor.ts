import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import {
  reviewPullRequest,
  countBlockers,
  estimateTokens,
  type IntentInput,
  type SkillInput,
} from '@devdigest/reviewer-core';
import { failureTrace } from './failure-trace.js';
import { redactCredentials } from '../../platform/jobs.js';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_PROVIDER_ROUTING, REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * One skill resolved as effective for a run (SPEC-02 D1). Structurally
 * identical to `skills/repository.ts`'s `EffectiveSkill` — declared locally
 * rather than imported, because a module never imports another module's
 * files (`modules-no-cross-import`); `container.skillsRepo` is the only
 * cross-module seam, per `AGENTS.md`.
 */
interface ResolvedSkill {
  id: string;
  name: string;
  version: number;
  body: string;
  sha256: string;
  promptSha256: string;
}

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
    private skills: Container['skillsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. skill resolution or diff load) fails EVERY queued
    // run. The error was already emitted via runLog (fanned out → in each
    // run's buffer); here we mark the rows failed and persist the buffered
    // log so it survives a reload. `skillsByAgent` is threaded through even on
    // a diff-load failure (skill resolution ran first and may have already
    // succeeded) so the failure trace still carries `skills_used`.
    const failAll = async (msg: string, skillsByAgent: Map<string, ResolvedSkill[]>) => {
      for (const { runId, agent } of jobs) {
        await this.saveRunSkills(runId, skillsByAgent.get(agent.id), logger);
        // Trace + terminal status in ONE locked transaction (see finishRun):
        // a reader that sees `failed` finds the trace, and a run the user
        // already cancelled keeps its cancel trace.
        await this.finishRun(
          runId,
          this.traceFromBuffer(runId, pull, agent, '0/0 passed', 0, skillsByAgent.get(agent.id)),
          {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          },
        ).catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    // Resolved next to the diff load (shared pre-work): every queued agent's
    // effective skills (SPEC-02 D1), ordered. A resolution failure fails every
    // queued run, same as a diff-load failure.
    let skillsByAgent: Map<string, ResolvedSkill[]> = new Map();
    try {
      skillsByAgent = await runLog.step(
        'Resolving agent skills',
        () => this.skills.resolveEffectiveSkills(jobs.map((j) => j.agent.id)),
        { kind: 'tool' },
      );
    } catch (err) {
      runLog.error(`Failed to resolve agent skills: ${(err as Error).message}`);
      await failAll(`Failed to resolve agent skills: ${(err as Error).message}`, skillsByAgent);
      return;
    }

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`, skillsByAgent);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // Derived intent (ADR 0022): a READ of a row stored for the CURRENT head, no
    // LLM and no network. Missing or stale -> the review runs without the slot
    // (byte-identical prompt) and a background derive is requested for next time.
    // Its own try/catch: an unexpected throw must never escape executeRuns, or
    // the queued runs stay 'running'.
    let intent: IntentInput | undefined;
    try {
      const fresh: Awaited<ReturnType<Container['prBrief']['readFreshIntent']>> =
        await this.container.prBrief.readFreshIntent(pull.id, pull.headSha);
      if (fresh.ok) {
        intent = fresh.intent;
        runLog.info(
          `intent: attached confidence=${fresh.intent.confidence} (derived ${fresh.headSha.slice(0, 7)}, ${fresh.provider ?? '?'}/${fresh.model ?? '?'})`,
        );
      } else {
        runLog.info(`intent: none — ${fresh.reason}`);
        // The service applies the automatic gate; it never rejects, `.catch` is belt-and-braces.
        void this.container.prBrief.requestDerive(workspaceId, pull.id, 'review_prework').catch(() => undefined);
      }
    } catch (err) {
      runLog.info(`intent: none — internal: ${(err as Error).message}`);
    }

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          runLog,
          skillsByAgent.get(agent.id) ?? [],
          intent,
          logger,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError || this.container.runBus.isCancelled(runId);
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    resolvedSkills: ResolvedSkill[],
    intent: IntentInput | undefined,
    logger?: Logger,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);
    // Aborted by a manual cancel (runBus.cancel): closes the in-flight LLM
    // request instead of leaving its socket open until the model answers.
    const cancelSignal = this.container.runBus.signal(runId);
    const throwIfCancelled = () => {
      if (cancelSignal.aborted || this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
    };

    try {
      throwIfCancelled();
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Derived PR intent (untrusted, wrapped + capped by assemblePrompt); omitted
        // when there is no fresh row, so the prompt stays byte-identical.
        ...(intent ? { intent } : {}),
        // SPEC-02 D1 — effective skills only (resolved in pre-work: link
        // enabled && skill enabled && !needs_vetting), in prompt order.
        ...(resolvedSkills.length > 0
          ? { skills: resolvedSkills.map((s): SkillInput => ({ name: s.name, body: s.body })) }
          : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: throwIfCancelled,
        signal: cancelSignal,
        callDeadlineMs: this.container.config.reviewCallDeadlineMs,
        // OpenRouter-only upstream routing (the other adapters ignore it).
        // Reasoning is left on — see the note under REVIEW_PROVIDER_ROUTING.
        ...(agent.provider === 'openrouter' ? { providerRouting: REVIEW_PROVIDER_ROUTING } : {}),
      });
      // A cancel that landed while the last call was returning: do not persist
      // a review for a run the user already cancelled.
      throwIfCancelled();
      const { tokensIn, tokensOut, grounding, costUsd, costSource } = outcome;

      const keptFindings = outcome.review.findings;

      // SPEC-02 AC-27 — snapshot of the skills resolved at run start, for the
      // trace. `skills_tokens` is reviewer-core's job (assemblePrompt sums the
      // rendered block); when that's absent (e.g. no skills, or an older
      // reviewer-core build) fall back to the sum of the per-skill estimates.
      const skillsUsed =
        resolvedSkills.length > 0
          ? resolvedSkills.map((s) => ({
              id: s.id,
              name: s.name,
              version: s.version,
              sha256: s.sha256,
              tokens: estimateTokens(s.body),
            }))
          : null;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Persist review + findings + trace + status: ONE transaction -------
      // The run row is locked FOR UPDATE first — the same lock
      // `cancelRunWithTrace` takes — so a cancel that slipped past the
      // throwIfCancelled() above is serialised against this write: if it
      // committed first we see `cancelled` and discard the result (no review,
      // no done-trace over the cancel trace); if we commit first the cancel
      // sees `done` and is a no-op. Within the transaction the trace still
      // lands before the status, and both become visible together.
      // Best effort and outside the transaction (stats are a read model), but
      // before it, so a persisted trace implies the rows were attempted.
      await this.saveRunSkills(runId, resolvedSkills, logger);
      const persisted = await this.repo.transaction(async (tx) => {
        const current = await tx.lockRunStatus(runId);
        if (current !== 'running') return { committed: false as const, status: current };

        const review = await tx.insertReview({
          workspaceId,
          prId: pull.id,
          agentId: agent.id,
          runId,
          kind: 'review',
          verdict: outcome.review.verdict,
          summary: outcome.review.summary,
          score: outcome.review.score,
          model: agent.model,
        });
        const findingRows = await tx.insertFindings(review.id, keptFindings);
        runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

        // Mark the commit this review ran against so the PR list can tell
        // reviewed / needs-review (head moved) / stale apart.
        await tx.markReviewed(pull.id, pull.headSha);

        const durationMs = Date.now() - start;
        const trace: RunTrace = {
          config: {
            agent: agent.name,
            version: String(agent.version),
            provider: agent.provider,
            model: agent.model,
            pr: pull.number,
            source: 'local',
          },
          stats: {
            duration_ms: durationMs,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            findings: findingRows.length,
            grounding,
            cost_usd: costUsd,
            cost_source: costSource,
            // Done, but no price entry for this model — the only "missing" case
            // possible on a successful run.
            cost_missing_reason: costUsd == null ? 'no_price' : undefined,
          },
          prompt_assembly: {
            ...outcome.assembly,
            skills_used: skillsUsed ?? outcome.assembly.skills_used ?? null,
            skills_tokens:
              outcome.assembly.skills_tokens ??
              (skillsUsed ? skillsUsed.reduce((sum, s) => sum + s.tokens, 0) : null),
          },
          tool_calls: outcome.chunks.map((c) => ({
            tool: 'review_file',
            args: c.label,
            meta: outcome.mode,
            ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
          })),
          raw_output: outcome.raw,
          memory_pulled: [],
          specs_read: [],
          // Persisted log = the run's FULL event buffer (incl. shared pre-work:
          // diff load + intent), not just events recorded inside this method.
          log: runLog.logFor(runId),
        };
        await tx.saveRunTrace(runId, trace);
        await tx.completeAgentRun(runId, {
          status: 'done',
          durationMs,
          tokensIn,
          tokensOut,
          findingsCount: findingRows.length,
          grounding,
          score: outcome.review.score,
          blockers,
          error: null,
          costUsd,
          costSource,
        });
        return { committed: true as const, review, findingRows };
      });
      if (!persisted.committed) {
        // A cancel committed between the last check and the lock: the catch
        // below refines the cancel trace. Any other non-running status (row
        // gone / reaped) is a plain failure whose write finishRun skips.
        if (persisted.status === 'cancelled') throw new RunCancelledError();
        throw new Error(`Run is no longer running (status: ${persisted.status ?? 'missing'}); result discarded`);
      }
      const { review, findingRows } = persisted;
      runLog.info('Run complete; trace persisted');
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      // A cancel aborts the LLM request, which rejects with the provider's
      // AbortError rather than RunCancelledError — the bus flag is the truth.
      const cancelled = err instanceof RunCancelledError || this.container.runBus.isCancelled(runId);
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : redactCredentials((err as Error).message);
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.saveRunSkills(runId, resolvedSkills, logger);
      // Trace + terminal status in one locked transaction — same invariant as
      // the success path (see finishRun for which states it may overwrite).
      await this.finishRun(
        runId,
        this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start, resolvedSkills),
        {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        },
      ).catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * Plan Phase 2: the run's effective skills as `run_skills` rows, written
   * right BEFORE `saveRunTrace` on every path that records `skills_used`, so
   * a persisted trace implies the rows were attempted. Best
   * effort: stats are a read model, so a failed write is logged and the run
   * keeps its status (never fails or rethrows because of it).
   */
  private async saveRunSkills(
    runId: string,
    skills: ResolvedSkill[] | undefined,
    logger?: Logger,
  ): Promise<void> {
    if (!skills || skills.length === 0) return;
    try {
      await this.repo.saveRunSkills(
        runId,
        skills.map((s) => ({
          skillId: s.id,
          skillVersion: s.version,
          bodySha256: s.sha256,
          promptSha256: s.promptSha256,
          tokens: estimateTokens(s.body),
        })),
      );
    } catch (err) {
      logger?.warn(
        { runId, err: (err as Error).message },
        'run_skills: write failed; skill stats will not count this run',
      );
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * Failure / cancel terminal write: trace THEN status, in ONE transaction with
   * the run row locked FOR UPDATE (serialised against `cancelRunWithTrace`).
   * Writes only over a `running` row — or over `cancelled` when this write is
   * the executor's own, fuller cancel trace. A `failed` write never lands on a
   * cancelled / done / reaped run. Returns whether it wrote.
   */
  private finishRun(
    runId: string,
    trace: RunTrace,
    values: Parameters<ReviewRepository['completeAgentRun']>[1],
  ): Promise<boolean> {
    return this.repo.transaction(async (tx) => {
      const current = await tx.lockRunStatus(runId);
      const writable = current === 'running' || (current === 'cancelled' && values.status === 'cancelled');
      if (!writable) return false;
      await tx.saveRunTrace(runId, trace);
      await tx.completeAgentRun(runId, values);
      return true;
    });
  }

  /** Failure/cancel trace from the run's SSE buffer (see failure-trace.ts). */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
    resolvedSkills?: ResolvedSkill[],
  ): RunTrace {
    return failureTrace({
      agent,
      prNumber: pull.number,
      grounding,
      durationMs,
      ...(resolvedSkills ? { resolvedSkills } : {}),
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    });
  }
}
