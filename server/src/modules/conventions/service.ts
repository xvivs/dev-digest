/**
 * APPLICATION — use cases of the conventions extractor (specs/02-conventions.md).
 * Depends on `domain.ts`, `ports.ts`, the prompt builder and the LLM schema:
 * no Drizzle, no Fastify, no concrete repository, no adapter construction.
 *
 *   startScan      AC-1..3   checks, insert running scan, enqueue, done.catch(markFailed)
 *   runScanJob     AC-9..19  SAMPLE → PROPOSE → VERIFY → PERSIST, one attempt, 100 s deadline
 *                            (terminal: only head_moved and LLM 429/5xx are retried)
 *   markFailed / reapStaleScans   AC-18
 *   getPage / update               AC-4, AC-5
 *   createSkill    AC-24..28 one unit of work
 */
import type { ConventionCategory, ConventionStatus, RepoRef } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { AGENT_SKILLS_BODY_BUDGET_BYTES, enabledSkillsBodyBytes } from '../_shared/skill-budget.js';
import { applySourcePolicy, assertSkillBodyHygiene } from '../_shared/skill-rules.js';
import {
  CONFIG_FILE_SLOTS,
  FILE_MAX_BYTES,
  FILE_MAX_LINES,
  LLM_MAX_RETRIES,
  LLM_SCHEMA_NAME,
  LLM_TEMPERATURE,
  MAX_CODE_FILES,
  MAX_CONFIG_FILES,
  MAX_FORCED_FILES,
  MAX_OUTPUT_TOKENS,
  CONVENTIONS_PROVIDER_ROUTING,
  PRIOR_LIMIT,
  RANKED_FETCH,
  REAPED_SCAN_ERROR,
  RECURRING_LIMIT,
  RECURRING_MIN_PRS,
  SAMPLE_MAX_BYTES,
  SCAN_DEADLINE_MS,
  SCAN_RETENTION,
} from './constants.js';
import {
  AgentSkillsBudgetExceededError,
  assertAllAccepted,
  assertSnippetsWithinCap,
  errorMessage,
  evidenceFilesOf,
  packSample,
  parseScanJobPayload,
  planConventionUpdate,
  renderSampleFile,
  RepoNotClonedError,
  RepoNotIndexedError,
  resolveAndMerge,
  ScanDeadlineError,
  ScanRunningError,
  ScanTransientError,
  sortCandidates,
  StaleAttemptError,
  stratifySample,
  verifyCandidates,
  type ConventionsPageData,
  type ConventionView,
  type CreatedSkill,
  type PriorIdentity,
  type RepoInfo,
  type SampleFile,
  type SampleKind,
  type ScanRecord,
  type ScanSignal,
  type VerifyResult,
} from './domain.js';
import { SalvagedExtraction } from './llm-schema.js';
import type { ConventionsDeps, ConventionStore, ScanCompletion, ScanProgress } from './ports.js';
import { buildExtractionPrompt } from './prompt.js';

export interface CreateSkillInput {
  name: string;
  description?: string;
  body: string;
  enabled: boolean;
  conventionIds: string[];
  agentIds: string[];
}

export interface CreateSkillResult {
  skill: CreatedSkill;
  linkedAgentIds: string[];
}

export interface ConventionPatchInput {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** What the running attempt has reached, so a failed attempt can still record it. */
interface AttemptState {
  attempt?: number;
  progress: ScanProgress;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

export class ConventionsService {
  private readonly store: ConventionStore;
  private readonly deadlineMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: ConventionsDeps) {
    this.store = deps.store;
    this.deadlineMs = deps.deadlineMs ?? SCAN_DEADLINE_MS;
    this.now = deps.now ?? (() => new Date());
  }

  // ------------------------------------------------------------ scans

  /**
   * AC-1..3. Returns undefined when the repo is not in this workspace (route → 404).
   * A running scan wins over every other check so a second click attaches to it.
   */
  async startScan(workspaceId: string, repoId: string): Promise<{ scanId: string } | undefined> {
    const repo = await this.store.findRepo(workspaceId, repoId);
    if (!repo) return undefined;

    const running = await this.store.findRunningScan(repoId);
    if (running) throw new ScanRunningError(running.id);

    const ref = refOf(repo);
    if (!repo.clonePath || !(await this.deps.files.cloneExists(ref))) throw new RepoNotClonedError();
    const indexStatus = await this.deps.repoIndex.indexStatus(repoId);
    if (indexStatus !== 'full' && indexStatus !== 'partial') throw new RepoNotIndexedError(indexStatus);

    // The partial unique index decides a race between two requests (23505 → ScanRunningError).
    const scan = await this.store.insertRunningScan(workspaceId, repoId);
    // Every step after the insert compensates with `failScan`: a scan row left `running`
    // would answer every later start with 409 until the boot-time reaper runs.
    try {
      const job = await this.deps.jobs.enqueue(workspaceId, { scanId: scan.id });
      // AC-18: retries exhausted or a non-retryable throw → the scan is failed, never left running.
      // Attached BEFORE any further await: if `setScanJob` throws, `done` must still be observed.
      job.done.catch((err: unknown) => {
        try {
          this.deps.onJobError?.(scan.id, err);
        } catch {
          // a throwing logger must not turn into an unhandled rejection
        }
        return this.markFailed(scan.id, err).catch(() => undefined);
      });
      await this.store.setScanJob(scan.id, job.id);
    } catch (err) {
      await this.store.failScan(scan.id, errorMessage(err));
      throw err;
    }
    return { scanId: scan.id };
  }

  /**
   * One attempt of the scan job. JobRunner calls it again only on a retryable
   * error: `head_moved` (503) or an LLM 429/5xx surfaced by the SDK. The
   * deadline starts here, at handler start, aborts the LLM call (AC-17) and is
   * terminal (`ScanDeadlineError`, 408). Before rethrowing, the attempt writes
   * what it has counted so far, so a failed scan keeps its stats.
   */
  async runScanJob(payload: unknown): Promise<void> {
    const { scanId } = parseScanJobPayload(payload);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    const state: AttemptState = { progress: {} };
    try {
      await this.runAttempt(scanId, controller.signal, startedAt, state);
    } catch (err) {
      if (err instanceof StaleAttemptError) return;
      if (state.attempt !== undefined) {
        // Best effort: a failed stats write must not mask the real error.
        await this.store.recordScanProgress(scanId, state.attempt, state.progress).catch(() => false);
      }
      if (controller.signal.aborted && !(err instanceof ScanTransientError)) {
        throw new ScanDeadlineError(this.deadlineMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Final failure (AC-18). Only a scan still `running` changes. */
  async markFailed(scanId: string, err: unknown): Promise<void> {
    await this.store.failScan(scanId, errorMessage(err));
  }

  /** Boot-time reaper, called from `app.ts` next to `reapStaleRuns` (AC-18). */
  reapStaleScans(): Promise<number> {
    return this.store.reapRunningScans(REAPED_SCAN_ERROR);
  }

  private async runAttempt(
    scanId: string,
    signal: AbortSignal,
    startedAt: number,
    state: AttemptState,
  ): Promise<void> {
    const scan = await this.store.bumpAttempt(scanId);
    if (!scan) return; // already done / failed: nothing to do
    const attempt = scan.attempt;
    state.attempt = attempt;
    const progress = state.progress;

    const repo = await this.store.findRepo(scan.workspaceId, scan.repoId);
    if (!repo) {
      await this.store.failScan(scanId, 'repo_not_found: the repo was removed', attempt);
      return;
    }
    const ref = refOf(repo);

    // AC-9: pin HEAD; every evidence link of this scan uses it.
    const sha = await this.deps.files.currentHead(ref);
    if (!(await this.store.setScanCommit(scanId, attempt, sha))) throw new StaleAttemptError();

    // ---- SAMPLE
    const signals = await this.loadSignals(scan.workspaceId, repo.id);
    const sent = await this.buildSample(repo, ref, signals);
    progress.sampleFileCount = sent.length;
    const codeFiles = sent.filter((f) => f.kind === 'code');
    if (codeFiles.length === 0) {
      // AC-10a: no LLM call; not retryable (a retry would read the same files).
      await this.store.recordScanProgress(scanId, attempt, progress);
      await this.store.failScan(scanId, 'empty_sample: no readable code files in the sample', attempt);
      return;
    }
    const prior = await this.store.listPrior(repo.id, PRIOR_LIMIT);
    if (signal.aborted) throw abortError();

    // ---- PROPOSE
    const choice = await this.deps.models.resolve(scan.workspaceId);
    progress.model = choice.model;
    const llm = await this.deps.models.llm(choice.provider);
    const remaining = this.deadlineMs - (Date.now() - startedAt);
    if (remaining <= 0 || signal.aborted) throw abortError();
    const prompt = buildExtractionPrompt({ repoFullName: repo.fullName, files: sent, signals, prior });
    const result = await llm.completeStructured<SalvagedExtraction>({
      model: choice.model,
      schema: SalvagedExtraction,
      schemaName: LLM_SCHEMA_NAME,
      messages: prompt.messages,
      // JSON mode keeps the AC-13 key order (json_schema gets re-sorted
      // upstream); the Zod schema still validates and drives the repair.
      responseFormat: 'json_object',
      // A hybrid reasoning model spends the 6000-token cap on hidden
      // reasoning and returns no content; extraction needs none.
      disableReasoning: true,
      providerRouting: CONVENTIONS_PROVIDER_ROUTING,
      temperature: LLM_TEMPERATURE,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: remaining,
      maxRetries: LLM_MAX_RETRIES,
      signal,
    });

    const stats = {
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      costSource: result.costSource,
    };
    Object.assign(progress, stats);

    // ---- VERIFY
    const verify = verifyCandidates({
      candidates: result.data.candidates,
      files: new Map(codeFiles.map((f) => [f.path, f.lines])),
      signals: new Map(signals.map((s) => [s.id, s])),
      priorRefs: new Set(prior.map((p) => p.ref)),
    });
    // Candidates the salvage parse dropped were proposed too: found and dropped (AC-15).
    verify.found += result.data.rejected;
    verify.dropped += result.data.rejected;
    Object.assign(progress, {
      foundCount: verify.found,
      verifiedCount: verify.verified.length,
      droppedCount: verify.dropped,
      relocatedCount: verify.relocated,
    });

    // AC-9 / Trap 7: evidence was read from the working tree; it must still be `sha`.
    if (signal.aborted) throw abortError();
    const head = await this.deps.files.currentHead(ref);
    if (head !== sha) {
      throw new ScanTransientError('head_moved', `HEAD moved from ${sha} to ${head} during the scan`);
    }

    // ---- PERSIST
    await this.persist({
      scan,
      prior,
      verify,
      sampleFileCount: sent.length,
      stats,
    });
  }

  private async persist(input: {
    scan: ScanRecord;
    prior: PriorIdentity[];
    verify: VerifyResult;
    sampleFileCount: number;
    stats: Pick<ScanCompletion, 'model' | 'tokensIn' | 'tokensOut' | 'costUsd' | 'costSource'>;
  }): Promise<void> {
    const { scan, prior, verify } = input;
    await this.store.transaction(async (tx) => {
      const index = await tx.identityIndex(scan.repoId);
      const merged = resolveAndMerge(verify.verified, new Map(prior.map((p) => [p.ref, p.id])), index);

      // AC-19: CAS first; a stale attempt throws and the transaction writes nothing.
      const owned = await tx.completeScan(scan.id, scan.attempt, {
        sampleFileCount: input.sampleFileCount,
        foundCount: verify.found,
        verifiedCount: verify.verified.length,
        droppedCount: verify.dropped,
        relocatedCount: verify.relocated,
        matchedPriorCount: merged.matchedPriorCount,
        duplicateCount: merged.duplicateCount,
        retryCount: Math.max(0, scan.attempt - 1),
        ...input.stats,
      });
      if (!owned) throw new StaleAttemptError();

      const ids: string[] = [];
      for (const o of merged.observations) {
        const id =
          o.existingId ??
          (await tx.upsertIdentity({ workspaceId: scan.workspaceId, repoId: scan.repoId, observation: o, scanId: scan.id }));
        // AC-21: a rejected identity gets its observation and stays rejected.
        await tx.insertObservation(scan.id, id, o);
        ids.push(id);
      }
      await tx.markSeen(ids, scan.id);
      await tx.applyRetention(scan.repoId, SCAN_RETENTION);
    });
  }

  private async loadSignals(workspaceId: string, repoId: string): Promise<ScanSignal[]> {
    const rows = await this.deps.reviews.recurringFindings(workspaceId, repoId, RECURRING_MIN_PRS, RECURRING_LIMIT);
    return rows.map((r, i) => ({
      id: `S${i + 1}`,
      category: r.category,
      title: r.title,
      prCount: r.prCount,
      files: r.files.filter((f) => typeof f === 'string' && f.length > 0),
    }));
  }

  /** AC-10/11/12: forced + stratified code files, then config files; packed into the 60 KB budget. */
  private async buildSample(repo: RepoInfo, ref: RepoRef, signals: ScanSignal[]): Promise<SampleFile[]> {
    const root = this.deps.files.cloneRoot(ref);
    const forced = unique(signals.flatMap((s) => s.files)).slice(0, MAX_FORCED_FILES);
    const ranked = await this.deps.repoIndex.topFilesByRank(repo.id, RANKED_FETCH);

    const code: SampleFile[] = [];
    for (const path of stratifySample(ranked, forced, MAX_CODE_FILES)) {
      const f = await this.readSampleFile(ref, root, path, 'code');
      if (f) code.push(f);
    }

    const taken = new Set(code.map((f) => f.path));
    const config: SampleFile[] = [];
    for (const slot of CONFIG_FILE_SLOTS) {
      if (config.length >= MAX_CONFIG_FILES) break;
      for (const path of slot) {
        if (taken.has(path)) continue;
        const f = await this.readSampleFile(ref, root, path, 'config');
        if (f) {
          config.push(f);
          break;
        }
      }
    }

    return packSample([...code, ...config], SAMPLE_MAX_BYTES).sent;
  }

  /** Guard, then read by the same relative path; any failure skips the file (G8). */
  private async readSampleFile(ref: RepoRef, root: string, path: string, kind: SampleKind): Promise<SampleFile | null> {
    try {
      await this.deps.files.assertSafe(root, path);
      const content = await this.deps.files.readFile(ref, path);
      return renderSampleFile(path, kind, content, FILE_MAX_LINES, FILE_MAX_BYTES);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ reads + decisions

  /** AC-4. Undefined when the repo is not in this workspace (route → 404). */
  async getPage(workspaceId: string, repoId: string): Promise<ConventionsPageData | undefined> {
    const repo = await this.store.findRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const page = await this.store.getPage(workspaceId, repoId);
    const latestId = page.latestDoneScan?.id ?? null;
    // AC-4: a pending identity the latest done scan did not observe is stale noise.
    // Accepted, edited and rejected ones stay (they carry a decision); nothing is deleted.
    const visible = page.candidates.filter(
      (c) => c.status !== 'pending' || c.editedAt !== null || (latestId !== null && c.lastSeenScanId === latestId),
    );
    return { ...page, candidates: sortCandidates(visible) };
  }

  /**
   * AC-5. Undefined when the convention is not in this workspace (route → 404).
   * Returns the latest done scan id too, so the DTO can say `seen_in_latest`.
   */
  update(
    workspaceId: string,
    id: string,
    patch: ConventionPatchInput,
  ): Promise<{ candidate: ConventionView; latestDoneScanId: string | null } | undefined> {
    return this.store.transaction(async (tx) => {
      const current = await tx.findConventionForUpdate(workspaceId, id);
      if (!current) return undefined;
      const write = planConventionUpdate(current, patch, this.now());
      if (Object.keys(write).length > 0) await tx.updateConvention(workspaceId, id, write);
      const candidate = await tx.getCandidate(workspaceId, id);
      if (!candidate) return undefined;
      return { candidate, latestDoneScanId: await tx.latestDoneScanId(current.repoId) };
    });
  }

  // ------------------------------------------------------------ skill creation

  /**
   * AC-24..28 in one transaction. Any id outside the workspace or repo is a 404;
   * a pending or rejected convention is a 422; an over-budget agent is a 422
   * that rolls back the skill and every link; a taken name is a 409 raised by
   * the skills repository and surfaced after the transaction aborts.
   */
  async createSkill(workspaceId: string, repoId: string, input: CreateSkillInput): Promise<CreateSkillResult> {
    const repo = await this.store.findRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    assertSkillBodyHygiene(input.body);
    assertSnippetsWithinCap(input.body);

    const conventionIds = unique(input.conventionIds);
    const agentIds = unique(input.agentIds);
    const policy = applySourcePolicy('extracted', input.body, input.enabled);

    return this.store.transaction(async (tx) => {
      const rows = await tx.lockConventions(workspaceId, repoId, conventionIds);
      if (rows.length !== conventionIds.length) {
        throw new NotFoundError('One or more conventions were not found in this repo');
      }
      assertAllAccepted(rows);

      const found = await tx.lockAgents(workspaceId, agentIds);
      if (found.length !== agentIds.length) {
        throw new NotFoundError('One or more agents were not found in this workspace');
      }

      const evidence = await tx.lastEvidence(conventionIds);
      const skill = await tx.insertSkill({
        workspaceId,
        name: input.name,
        description: input.description ?? '',
        body: input.body,
        enabled: policy.enabled,
        needsVetting: policy.needsVetting,
        vettedBodyHash: policy.vettedBodyHash,
        evidenceFiles: evidenceFilesOf(evidence),
      });

      for (const agentId of agentIds) {
        const state = await tx.agentLinkState(agentId);
        const bytes = enabledSkillsBodyBytes(
          [...state.links, { skillId: skill.id, enabled: true }],
          [...state.skills, { id: skill.id, enabled: skill.enabled, body: skill.body }],
        );
        if (bytes > AGENT_SKILLS_BODY_BUDGET_BYTES) {
          throw new AgentSkillsBudgetExceededError(agentId, bytes, AGENT_SKILLS_BODY_BUDGET_BYTES);
        }
        await tx.appendAgentLink(agentId, skill.id);
      }
      await tx.linkConventionsToSkill(conventionIds, skill.id);
      return { skill, linkedAgentIds: agentIds };
    });
  }
}

function refOf(repo: RepoInfo): RepoRef {
  return { owner: repo.owner, name: repo.name };
}
