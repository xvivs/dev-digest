/**
 * APPLICATION — the brief service (ADR 0022): derives a PR's intent and risk
 * areas on cheap feature models, as a background job at PR import plus an
 * on-demand button. It owns the in-memory queued/running state, the failure and
 * negative caches and the automatic gate. No SQL, no Fastify: everything
 * external arrives through `ports.ts`.
 *
 * Single-instance assumption (AGENTS.md): the in-memory state is per process.
 */
import type {
  BriefFailure,
  BriefFailureReason,
  IntentConfidence,
  PrDetail,
  RepoRef,
  UnresolvedLink,
} from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';
import {
  AUTO_BRIEF_MAX_ATTEMPTS,
  BRIEF_STATE_MAX_ENTRIES,
  AUTO_BRIEF_MAX_PER_SYNC,
  DOC_READ_MAX_BYTES,
  FETCH_HEAD_BUDGET_MS,
  INTENT_BUDGET_MS,
  INTENT_MAX_OUTPUT_TOKENS,
  INTENT_SCHEMA_NAME,
  LLM_CALL_TIMEOUT_MS,
  LLM_MAX_RETRIES,
  LLM_TEMPERATURE,
  MAX_UNRESOLVED_LINKS,
  NEGATIVE_CACHE_TTL_MS,
  RISKS_BUDGET_MS,
  RISKS_SCHEMA_NAME,
  RISK_MAX_OUTPUT_TOKENS,
} from './constants.js';
import {
  buildIntentSources,
  capConfidence,
  confidenceCap,
  finalizeRisks,
  meaningfulLength,
  planLinks,
  ruleRisks,
  type GroundingFile,
  type RiskFile,
} from './domain.js';
import { buildIntentPrompt, sanitizeIntentOutput } from './intent-prompt.js';
import { IntentLlmSchema, RisksLlmSchema } from './llm-schema.js';
import type {
  BriefFile,
  BriefLogger,
  BriefPull,
  BriefStore,
  DiffParser,
  GithubSource,
  GitSource,
  JobsPort,
  ModelsPort,
  PullSource,
  SettingsPort,
} from './ports.js';
import { buildRiskPrompt, sanitizeRiskOutput } from './risk-prompt.js';
import {
  NEGATIVE_CACHED_REASONS,
  type BriefPhase,
  type BriefTrigger,
  type DerivePayload,
  type DeriveOutcome,
  type FreshIntent,
  type ImportTrigger,
  type PrBriefFacade,
  type PrIntentView,
  type PrRisksView,
} from './types.js';

export interface BriefDeps {
  store: BriefStore;
  pulls: PullSource;
  github: GithubSource;
  git: GitSource;
  models: ModelsPort;
  settings: SettingsPort;
  jobs: JobsPort;
  diff: DiffParser;
  log: BriefLogger;
  /** Hard env kill-switch (`AUTO_BRIEF`). */
  autoBriefEnabled: boolean;
  now?: () => number;
}

interface PrState {
  queued: number;
  running?: Promise<DeriveOutcome>;
}

/** Everything one derivation reads about the PR, from GitHub detail or the persisted rows. */
interface PullInputs {
  title: string;
  body: string | null;
  commits: string[];
  files: BriefFile[];
  persisted: boolean;
}

class PhaseFailure extends Error {
  constructor(readonly reason: BriefFailureReason) {
    super(reason);
  }
}

class BudgetExceeded extends Error {}

const refOf = (r: RepoRef): RepoRef => ({ owner: r.owner, name: r.name });

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Map an LLM-call error to a stable failure reason. */
export function classifyLlmError(err: unknown, signal?: AbortSignal): BriefFailureReason {
  if (err instanceof ConfigError) return 'provider_not_configured';
  if (err instanceof PhaseFailure) return err.reason;
  if (signal?.aborted || err instanceof BudgetExceeded) return 'timeout';
  const name = (err as { name?: string } | null)?.name ?? '';
  const msg = errMessage(err);
  if (name === 'AbortError' || name === 'TimeoutError' || /timed? ?out|timeout|aborted/i.test(msg)) return 'timeout';
  if (name === 'ZodError' || /schema validation|parse|json/i.test(msg)) return 'parse_error';
  return 'llm_error';
}

export class BriefService implements PrBriefFacade {
  private readonly state = new Map<string, PrState>();
  /** `${prId}|${head}|${phase}` -> latest failure. Cleared by a success for that key. */
  private readonly failures = new Map<string, BriefFailure>();
  /** `${prId}|${head}|${phase}` -> expiry (ms). */
  private readonly negative = new Map<string, number>();
  /** `${prId}|${head}` -> automatic attempts. */
  private readonly attempts = new Map<string, number>();

  constructor(private readonly deps: BriefDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  // ============================================================ reads

  async getIntent(workspaceId: string, prId: string): Promise<PrIntentView | undefined> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const record = (await this.deps.store.getIntent(prId)) ?? null;
    return {
      record,
      stale: record !== null && record.head_sha !== pull.headSha,
      inFlight: this.isInFlight(prId),
      lastFailure: this.failures.get(this.key(prId, pull.headSha, 'intent')) ?? null,
    };
  }

  async getRisks(workspaceId: string, prId: string): Promise<PrRisksView | undefined> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const record = (await this.deps.store.getRisks(prId)) ?? null;
    return {
      record,
      stale: record !== null && record.head_sha !== pull.headSha,
      inFlight: this.isInFlight(prId),
      lastFailure: this.failures.get(this.key(prId, pull.headSha, 'risks')) ?? null,
    };
  }

  isInFlight(prId: string): boolean {
    const s = this.state.get(prId);
    return !!s && (s.queued > 0 || s.running != null);
  }

  /** Review pre-work: a row for the current head or nothing. No LLM, no network. */
  async readFreshIntent(prId: string, headSha: string): Promise<FreshIntent> {
    const row = await this.deps.store.getIntent(prId);
    if (!row || row.intent.trim().length === 0) return { ok: false, reason: 'missing' };
    if (row.head_sha !== headSha) return { ok: false, reason: 'stale' };
    return {
      ok: true,
      intent: {
        intent: row.intent,
        inScope: row.in_scope,
        outOfScope: row.out_of_scope,
        confidence: row.confidence,
      },
      headSha,
      provider: row.provider,
      model: row.model,
    };
  }

  // ============================================================ requests

  async requestDerive(
    workspaceId: string,
    prId: string,
    trigger: BriefTrigger,
    opts: { onlyIfIdle?: boolean } = {},
  ): Promise<{ queued: boolean } | undefined> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) return undefined;
    // No `await` between this check and `enqueue`'s synchronous bump, so two
    // concurrent idle-only requests queue one job.
    if (opts.onlyIfIdle && this.isInFlight(prId)) return { queued: false };
    if (trigger !== 'on_demand') {
      try {
        if (this.isInFlight(prId)) return { queued: false };
        if (!(await this.automaticGate(workspaceId))) return { queued: false };
        const rows = await this.presence(prId, pull.headSha);
        if (!this.pullAllowed(pull, rows.hasIntent, rows.hasRisks)) return { queued: false };
      } catch (err) {
        this.deps.log.warn({ prId, trigger, err: errMessage(err) }, 'brief: request gate failed');
        return { queued: false };
      }
    }
    return { queued: await this.enqueue(workspaceId, prId, trigger) };
  }

  async scheduleForRepo(workspaceId: string, repoId: string, trigger: ImportTrigger): Promise<void> {
    try {
      if (!(await this.automaticGate(workspaceId))) {
        this.deps.log.debug({ repoId, trigger, queued: 0, gate: 'closed' }, 'brief: scheduling skipped');
        return;
      }
      const candidates = await this.deps.store.listScheduleCandidates(workspaceId, repoId);
      const skipped = { inFlight: 0, negative: 0, cap: 0 };
      const picked: string[] = [];
      for (const c of candidates) {
        if (picked.length >= AUTO_BRIEF_MAX_PER_SYNC) break;
        const why = this.skipReason(c.prId, c.headSha, c.hasIntent, c.hasRisks);
        if (why) {
          skipped[why] += 1;
          continue;
        }
        picked.push(c.prId);
      }
      let queued = 0;
      for (const prId of picked) if (await this.enqueue(workspaceId, prId, trigger)) queued += 1;
      this.deps.log.debug(
        { repoId, trigger, candidates: candidates.length, queued, skipped, providerConfigured: true },
        'brief: scheduling pass',
      );
    } catch (err) {
      this.deps.log.warn({ repoId, trigger, err: errMessage(err) }, 'brief: scheduling failed');
    }
  }

  async scheduleForPull(workspaceId: string, prId: string, trigger: ImportTrigger): Promise<void> {
    try {
      if (!(await this.automaticGate(workspaceId))) {
        this.deps.log.debug({ prId, trigger, queued: 0, gate: 'closed' }, 'brief: scheduling skipped');
        return;
      }
      const pull = await this.deps.pulls.getPull(workspaceId, prId);
      if (!pull || pull.status !== 'open') return;
      const rows = await this.presence(prId, pull.headSha);
      const why = this.skipReason(prId, pull.headSha, rows.hasIntent, rows.hasRisks);
      if (why || (rows.hasIntent && rows.hasRisks)) {
        this.deps.log.debug({ prId, trigger, queued: 0, skipped: why ?? 'fresh' }, 'brief: scheduling pass');
        return;
      }
      await this.enqueue(workspaceId, prId, trigger);
    } catch (err) {
      this.deps.log.warn({ prId, trigger, err: errMessage(err) }, 'brief: scheduling failed');
    }
  }

  // ============================================================ gate + bookkeeping

  isAutomaticEnabled(workspaceId: string): Promise<boolean> {
    return this.deps.settings.autoBrief(workspaceId);
  }

  /** Env kill-switch AND the workspace toggle AND a configured `review_intent` provider. */
  private async automaticGate(workspaceId: string): Promise<boolean> {
    if (!this.deps.autoBriefEnabled) return false;
    if (!(await this.deps.settings.autoBrief(workspaceId))) return false;
    return this.deps.models.isConfigured(workspaceId);
  }

  private key(prId: string, head: string, phase: BriefPhase): string {
    return `${prId}|${head}|${phase}`;
  }

  private async presence(prId: string, head: string): Promise<{ hasIntent: boolean; hasRisks: boolean }> {
    const [i, r] = await Promise.all([this.deps.store.getIntent(prId), this.deps.store.getRisks(prId)]);
    return { hasIntent: i?.head_sha === head, hasRisks: r?.head_sha === head };
  }

  private isNegative(prId: string, head: string, phase: BriefPhase): boolean {
    const k = this.key(prId, head, phase);
    const until = this.negative.get(k);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.negative.delete(k);
      return false;
    }
    return true;
  }

  /** Why an automatic run should skip this PR, or undefined when it may proceed. */
  private skipReason(
    prId: string,
    head: string,
    hasIntent: boolean,
    hasRisks: boolean,
  ): 'inFlight' | 'negative' | 'cap' | undefined {
    if (this.isInFlight(prId)) return 'inFlight';
    if ((!hasIntent && this.isNegative(prId, head, 'intent')) || (!hasRisks && this.isNegative(prId, head, 'risks'))) {
      return 'negative';
    }
    if ((this.attempts.get(`${prId}|${head}`) ?? 0) >= AUTO_BRIEF_MAX_ATTEMPTS) return 'cap';
    return undefined;
  }

  private pullAllowed(pull: BriefPull, hasIntent: boolean, hasRisks: boolean): boolean {
    if (pull.status !== 'open') return false;
    if (hasIntent && hasRisks) return false;
    return this.skipReason(pull.id, pull.headSha, hasIntent, hasRisks) === undefined;
  }

  private bump(prId: string, delta: number): void {
    const s = this.state.get(prId) ?? { queued: 0 };
    s.queued = Math.max(0, s.queued + delta);
    if (s.queued === 0 && s.running == null) this.state.delete(prId);
    else this.state.set(prId, s);
  }

  /**
   * Mark queued, enqueue, and account for the job settling. Returns false (and
   * rolls back) when the enqueue fails and the trigger is not `on_demand`;
   * `on_demand` rethrows.
   */
  private async enqueue(workspaceId: string, prId: string, trigger: BriefTrigger): Promise<boolean> {
    this.bump(prId, +1);
    let job: { done: Promise<void> };
    try {
      job = await this.deps.jobs.enqueue(workspaceId, {
        workspaceId,
        prId,
        trigger,
        enqueuedAt: new Date(this.now()).toISOString(),
      });
    } catch (err) {
      this.bump(prId, -1);
      if (trigger === 'on_demand') throw err;
      this.deps.log.warn({ prId, trigger, err: errMessage(err) }, 'brief: enqueue failed');
      return false;
    }
    // The queued mark is released exactly once, when the job settles (the
    // handler never throws, and a pre-handler failure also settles `done`).
    const settle = () => this.bump(prId, -1);
    job.done.then(settle, settle);
    return true;
  }

  /**
   * Bounded write for the per-(pr, head) maps: drops this PR's entries for any
   * other head (a stale head is never read again) and, past the cap, the oldest
   * entries by insertion order.
   */
  private remember<V>(map: Map<string, V>, prId: string, head: string, key: string, value: V): void {
    const current = `${prId}|${head}`;
    for (const k of map.keys()) {
      if (k.startsWith(`${prId}|`) && k !== current && !k.startsWith(`${current}|`)) map.delete(k);
    }
    map.set(key, value);
    for (const k of map.keys()) {
      if (map.size <= BRIEF_STATE_MAX_ENTRIES) break;
      map.delete(k);
    }
  }

  private recordFailure(prId: string, head: string, phase: BriefPhase, reason: BriefFailureReason): void {
    const k = this.key(prId, head, phase);
    this.remember(this.failures, prId, head, k, { reason, at: new Date(this.now()).toISOString() });
    if (NEGATIVE_CACHED_REASONS.includes(reason)) {
      this.remember(this.negative, prId, head, k, this.now() + NEGATIVE_CACHE_TTL_MS);
    }
  }

  private recordSuccess(prId: string, head: string, phase: BriefPhase): void {
    const k = this.key(prId, head, phase);
    this.failures.delete(k);
    this.negative.delete(k);
  }

  // ============================================================ job handler

  async derive(workspaceId: string, prId: string, payload: DerivePayload): Promise<DeriveOutcome> {
    // The handler never throws (no retry spend); the queued mark is released by `enqueue`'s settle.
    try {
      const st = this.state.get(prId) ?? { queued: 0 };
      this.state.set(prId, st);
      if (st.running) return await st.running.catch((): DeriveOutcome => ({ ok: false, reason: 'internal' }));
      const run = this.runDerive(workspaceId, prId, payload).catch(
        (err): DeriveOutcome => {
          this.deps.log.warn({ prId, reason: 'internal', err: errMessage(err) }, 'brief: derive crashed');
          return { ok: false, reason: 'internal' };
        },
      );
      st.running = run;
      try {
        return await run;
      } finally {
        if (st.running === run) st.running = undefined;
      }
    } catch {
      return { ok: false, reason: 'internal' };
    }
  }

  private fresh(row: { head_sha: string | null; derived_at: string } | undefined, head: string, p: DerivePayload) {
    if (!row || row.head_sha !== head) return false;
    // Automatic triggers never redo a current row; on_demand redoes it unless a
    // newer one was written since it was enqueued.
    return p.trigger !== 'on_demand' || row.derived_at > p.enqueuedAt;
  }

  private async runDerive(workspaceId: string, prId: string, payload: DerivePayload): Promise<DeriveOutcome> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) return { ok: false, reason: 'no_pull' };
    const head = pull.headSha;
    const automatic = payload.trigger !== 'on_demand';
    const [intentRow, risksRow] = await Promise.all([this.deps.store.getIntent(prId), this.deps.store.getRisks(prId)]);
    const needIntent = !this.fresh(intentRow, head, payload);
    const needRisks = !this.fresh(risksRow, head, payload);
    if (!needIntent && !needRisks) return { ok: true };

    const attemptKey = `${prId}|${head}`;
    if (automatic) this.remember(this.attempts, prId, head, attemptKey, (this.attempts.get(attemptKey) ?? 0) + 1);
    const fail = (reason: BriefFailureReason, phases: BriefPhase[]): DeriveOutcome => {
      for (const ph of phases) this.recordFailure(prId, head, ph, reason);
      // A moved head is not the PR's fault: it does not count toward the cap.
      if (reason === 'head_moved' && automatic) {
        this.attempts.set(attemptKey, Math.max(0, (this.attempts.get(attemptKey) ?? 1) - 1));
      }
      this.deps.log.warn({ prId, phase: phases.join('+'), reason }, 'brief: derive failed');
      return { ok: false, reason };
    };

    const repo = await this.deps.pulls.getRepo(pull.repoId);
    if (!repo) return fail('no_pull', [...(needIntent ? (['intent'] as const) : []), ...(needRisks ? (['risks'] as const) : [])]);
    const ref = refOf(repo);

    let inputs: PullInputs | undefined;
    let outcome: DeriveOutcome = { ok: true };
    let intentText: string | null = intentRow && intentRow.head_sha === head ? intentRow.intent : null;

    // ---- INTENT (the budget includes the GitHub detail fetch, done first)
    if (needIntent) {
      const budget = this.budget(INTENT_BUDGET_MS);
      try {
        inputs = await this.gatherInputs(pull, ref, payload, budget);
        const links = planLinks(inputs.body, ref);
        const res = await this.deriveIntent(workspaceId, pull, ref, inputs, links, budget, payload.trigger);
        intentText = res.intent;
        this.recordSuccess(prId, head, 'intent');
      } catch (err) {
        const reason = classifyLlmError(err, budget.signal);
        if (reason === 'head_moved' || (inputs === undefined && err instanceof PhaseFailure)) {
          // Inputs unavailable / head moved: nothing can be derived for either phase.
          budget.dispose();
          return fail(reason, needRisks ? ['intent', 'risks'] : ['intent']);
        }
        fail(reason, ['intent']);
        outcome = { ok: false, reason };
      } finally {
        budget.dispose();
      }
    }

    // ---- RISKS
    if (needRisks) {
      const budget = this.budget(RISKS_BUDGET_MS);
      try {
        inputs ??= await this.gatherInputs(pull, ref, payload, budget);
        await this.deriveRisks(workspaceId, pull, inputs, intentText, budget);
        this.recordSuccess(prId, head, 'risks');
      } catch (err) {
        const reason = classifyLlmError(err, budget.signal);
        if (reason === 'head_moved' || inputs === undefined) {
          budget.dispose();
          return fail(reason, ['risks']);
        }
        // LLM failure: keep the deterministic rule risks (rule_only).
        await this.storeRuleOnly(pull, inputs);
        fail(reason, ['risks']);
        if (outcome.ok) outcome = { ok: false, reason };
      } finally {
        budget.dispose();
      }
    }
    return outcome;
  }

  // ============================================================ budgets

  private budget(ms: number): { signal: AbortSignal; remaining(): number; dispose(): void } {
    const ctl = new AbortController();
    const deadline = this.now() + ms;
    const timer = setTimeout(() => ctl.abort(), ms);
    return {
      signal: ctl.signal,
      remaining: () => Math.max(0, deadline - this.now()),
      dispose: () => clearTimeout(timer),
    };
  }

  /** Race a signal-less call against the phase budget. */
  private raced<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      p.catch(() => undefined);
      return Promise.reject(new BudgetExceeded());
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new BudgetExceeded());
      signal.addEventListener('abort', onAbort, { once: true });
      p.then(
        (v) => {
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }

  // ============================================================ inputs

  /**
   * The PR data for a derivation. Automatic triggers use the live GitHub detail
   * only when its head equals the persisted one; `on_demand` may fall back to the
   * persisted rows (seeded / offline).
   */
  private async gatherInputs(
    pull: BriefPull,
    ref: RepoRef,
    payload: DerivePayload,
    budget: { signal: AbortSignal },
  ): Promise<PullInputs> {
    let detail: PrDetail | undefined;
    let detailErr: unknown;
    try {
      detail = await this.raced(this.deps.github.getPullDetail(ref, pull.number), budget.signal);
    } catch (err) {
      detailErr = err;
    }
    if (detail) {
      if (detail.head_sha !== pull.headSha) throw new PhaseFailure('head_moved');
      return {
        title: detail.title,
        body: detail.body ?? null,
        commits: detail.commits.map((c) => c.message),
        files: detail.files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        persisted: false,
      };
    }
    if (payload.trigger !== 'on_demand') {
      throw new PhaseFailure(detailErr instanceof BudgetExceeded ? 'timeout' : 'internal');
    }
    const [files, commits] = await Promise.all([this.deps.pulls.getFiles(pull.id), this.deps.pulls.getCommits(pull.id)]);
    return {
      title: pull.title,
      body: pull.body,
      commits: commits.map((c) => c.message),
      files,
      persisted: true,
    };
  }

  // ============================================================ intent phase

  private async deriveIntent(
    workspaceId: string,
    pull: BriefPull,
    ref: RepoRef,
    inputs: PullInputs,
    links: ReturnType<typeof planLinks>,
    budget: { signal: AbortSignal; remaining(): number },
    trigger: BriefTrigger,
  ): Promise<{ intent: string }> {
    const started = this.now();
    const unresolved: UnresolvedLink[] = [...links.unresolved];

    // Linked docs at head_sha (object DB, never the working tree).
    const docs: { path: string; text: string; ref: string }[] = [];
    for (const d of links.docs) {
      const r = await this.readDoc(ref, pull, d.path, budget);
      if (r.status === 'ok') docs.push({ path: d.path, text: r.text, ref: d.urlRef ? `${d.path}@${d.urlRef}` : d.path });
      else unresolved.push({ url: d.path, reason: r.reason });
    }
    // Same-repo issues only (the job ignores detail.linked_issue).
    let issue: { number: number; title: string; body: string | null } | null = null;
    for (const n of links.issues) {
      try {
        const i = await this.raced(this.deps.github.getIssue(ref, n), budget.signal);
        issue = { number: i.number, title: i.title, body: i.body ?? null };
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err;
        unresolved.push({ url: `#${n}`, reason: 'fetch_failed' });
      }
    }

    const prompt = buildIntentPrompt({
      title: inputs.title,
      body: inputs.body,
      branch: pull.branch,
      commits: inputs.commits,
      paths: inputs.files.map((f) => f.path),
      additions: pull.additions,
      deletions: pull.deletions,
      filesCount: pull.filesCount || inputs.files.length,
      issue,
      docs,
    });

    const choice = await this.deps.models.resolve(workspaceId, 'review_intent');
    const llm = await this.deps.models.llm(choice.provider);
    const timeoutMs = Math.min(LLM_CALL_TIMEOUT_MS, budget.remaining());
    if (timeoutMs <= 0) throw new BudgetExceeded();
    const result = await llm.completeStructured({
      model: choice.model,
      schema: IntentLlmSchema,
      schemaName: INTENT_SCHEMA_NAME,
      messages: prompt.messages,
      responseFormat: 'json_object',
      disableReasoning: true,
      temperature: LLM_TEMPERATURE,
      maxTokens: INTENT_MAX_OUTPUT_TOKENS,
      timeoutMs,
      maxRetries: LLM_MAX_RETRIES,
      signal: budget.signal,
    });
    const out = sanitizeIntentOutput(result.data);
    if (out.intent.length === 0) throw new PhaseFailure('parse_error');

    const descriptionChars = meaningfulLength(inputs.body);
    const cap = confidenceCap({
      descriptionChars,
      hasResolvedDoc: docs.length > 0,
      hasIssueBody: (issue?.body ?? '').trim().length > 0,
      unresolved,
    });
    const confidence: IntentConfidence = capConfidence(out.confidence, cap);
    const persistedRef = inputs.persisted ? 'persisted' : null;
    const sources = buildIntentSources({
      title: inputs.title,
      descriptionChars,
      issueRef: issue ? `#${issue.number}` : null,
      issueChars: prompt.sent.issue,
      docs: docs.map((d, i) => ({ ref: d.ref, chars: prompt.sent.docs[i] ?? d.text.length })),
      branch: pull.branch,
      commitChars: prompt.sent.commits,
      pathChars: prompt.sent.paths,
      hasDiffstat: true,
    }).map((s) => (s.ref === null && persistedRef && s.kind !== 'title' ? { ...s, ref: persistedRef } : s));

    await this.deps.store.upsertIntent(pull.id, {
      headSha: pull.headSha,
      intent: out.intent,
      inScope: out.inScope,
      outOfScope: out.outOfScope,
      confidence,
      sources,
      unresolvedLinks: unresolved.slice(0, MAX_UNRESOLVED_LINKS),
      provider: choice.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      costSource: result.costSource,
    });
    this.deps.log.info(
      {
        prId: pull.id,
        phase: 'intent',
        trigger,
        provider: choice.provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        costSource: result.costSource,
        durationMs: this.now() - started,
        confidence,
        sources: sources.map((s) => s.kind),
        unresolved: unresolved.length,
      },
      'brief: intent derived',
    );
    return { intent: out.intent };
  }

  private async readDoc(
    ref: RepoRef,
    pull: BriefPull,
    path: string,
    budget: { signal: AbortSignal },
  ): Promise<{ status: 'ok'; text: string } | { status: 'unresolved'; reason: UnresolvedLink['reason'] }> {
    const read = async () => this.raced(this.deps.git.readFileAtRef(ref, pull.headSha, path, DOC_READ_MAX_BYTES), budget.signal);
    try {
      let r = await read();
      if (r.status === 'missing_commit') {
        // The head may be missing from the shallow clone: one forced fetch, then retry.
        const fetchSignal = AbortSignal.any([budget.signal, AbortSignal.timeout(FETCH_HEAD_BUDGET_MS)]);
        await this.raced(this.deps.git.fetchPullHead(ref, pull.number, { signal: fetchSignal }), fetchSignal);
        r = await read();
      }
      switch (r.status) {
        case 'ok':
          return { status: 'ok', text: r.text };
        case 'not_found':
          return { status: 'unresolved', reason: 'not_found' };
        case 'not_a_file':
          return { status: 'unresolved', reason: 'unsafe_path' };
        case 'too_large':
          return { status: 'unresolved', reason: 'too_large' };
        default:
          return { status: 'unresolved', reason: 'not_available' };
      }
    } catch (err) {
      if (budget.signal.aborted) throw new BudgetExceeded();
      this.deps.log.debug({ prId: pull.id, path, err: errMessage(err) }, 'brief: doc read failed');
      return { status: 'unresolved', reason: 'not_available' };
    }
  }

  // ============================================================ risks phase

  private groundingFiles(files: BriefFile[]): GroundingFile[] {
    return files.map((f) => {
      if (!f.patch) return { path: f.path, ranges: null };
      const raw = [`diff --git a/${f.path} b/${f.path}`, `--- a/${f.path}`, `+++ b/${f.path}`, f.patch].join('\n');
      const parsed = this.deps.diff.parse(raw).files.find((x) => x.path === f.path) ?? this.deps.diff.parse(raw).files[0];
      const ranges = (parsed?.hunks ?? [])
        .filter((h) => h.newLines > 0)
        .map((h) => ({ start: h.newStart, end: h.newStart + h.newLines - 1 }));
      return { path: f.path, ranges };
    });
  }

  private riskFiles(files: BriefFile[]): RiskFile[] {
    return files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, patch: f.patch }));
  }

  private async deriveRisks(
    workspaceId: string,
    pull: BriefPull,
    inputs: PullInputs,
    intentText: string | null,
    budget: { signal: AbortSignal; remaining(): number },
  ): Promise<void> {
    const started = this.now();
    const rules = ruleRisks(this.riskFiles(inputs.files));
    const prompt = buildRiskPrompt({ files: inputs.files, ruleRisks: rules, intent: intentText });

    const choice = await this.deps.models.resolve(workspaceId, 'risk_brief');
    const llm = await this.deps.models.llm(choice.provider);
    const timeoutMs = Math.min(LLM_CALL_TIMEOUT_MS, budget.remaining());
    if (timeoutMs <= 0) throw new BudgetExceeded();
    const result = await llm.completeStructured({
      model: choice.model,
      schema: RisksLlmSchema,
      schemaName: RISKS_SCHEMA_NAME,
      messages: prompt.messages,
      responseFormat: 'json_object',
      disableReasoning: true,
      temperature: LLM_TEMPERATURE,
      maxTokens: RISK_MAX_OUTPUT_TOKENS,
      timeoutMs,
      maxRetries: LLM_MAX_RETRIES,
      signal: budget.signal,
    });
    const modelRisks = sanitizeRiskOutput(result.data);
    const final = finalizeRisks(rules, modelRisks, this.groundingFiles(inputs.files));

    await this.deps.store.upsertRisks(pull.id, {
      headSha: pull.headSha,
      risks: final.risks,
      droppedRefs: final.droppedRefs,
      ruleOnly: false,
      provider: choice.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      costSource: result.costSource,
    });
    this.deps.log.info(
      {
        prId: pull.id,
        phase: 'risks',
        provider: choice.provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        costSource: result.costSource,
        durationMs: this.now() - started,
        rules: rules.length,
        model_risks: final.risks.length - rules.length,
        droppedRefs: final.droppedRefs,
        ruleOnly: false,
      },
      'brief: risks derived',
    );
  }

  /** The LLM call failed: keep what is deterministic. */
  private async storeRuleOnly(pull: BriefPull, inputs: PullInputs): Promise<void> {
    try {
      const rules = ruleRisks(this.riskFiles(inputs.files));
      await this.deps.store.upsertRisks(pull.id, {
        headSha: pull.headSha,
        risks: rules,
        droppedRefs: 0,
        ruleOnly: true,
        provider: null,
        model: null,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        costSource: null,
      });
    } catch (err) {
      this.deps.log.warn({ prId: pull.id, err: errMessage(err) }, 'brief: rule-only store failed');
    }
  }
}
