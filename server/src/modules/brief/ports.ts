/**
 * PORTS — what the brief service needs from the outside, declared by the inner
 * ring. `repository.ts` implements `BriefStore` with Drizzle; `wiring.ts` adapts
 * the container (review repo, GitHub, git, LLM, settings, jobs) to the narrow
 * ports below; the unit tests fake all of them.
 */
import type {
  CostSource,
  FeatureModelChoice,
  FeatureModelId,
  IntentConfidence,
  IntentSource,
  IssueMeta,
  LLMProvider,
  PrDetail,
  PrIntentRecord,
  PrRisksRecord,
  ReadFileAtRefResult,
  RepoRef,
  Risk,
  UnifiedDiff,
  UnresolvedLink,
} from '@devdigest/shared';
import type { DerivePayload } from './types.js';

// ---- pulls (container.reviewRepo) ------------------------------------------
export interface BriefPull {
  id: string;
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  branch: string;
  base: string;
  /** The PERSISTED head_sha: the freshness key of every brief row. */
  headSha: string;
  body: string | null;
  /** GitHub merge state: 'open' | 'merged' | 'closed'. */
  status: string;
  additions: number;
  deletions: number;
  filesCount: number;
}

export interface BriefFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PullSource {
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  getRepo(repoId: string): Promise<(RepoRef & { id: string }) | undefined>;
  getFiles(prId: string): Promise<BriefFile[]>;
  getCommits(prId: string): Promise<{ message: string }[]>;
}

// ---- outside world ------------------------------------------------------------
export interface GithubSource {
  /** Throws `ConfigError` with no token; the service treats any throw as "unavailable". */
  getPullDetail(repo: RepoRef, number: number): Promise<PrDetail>;
  getIssue(repo: RepoRef, number: number): Promise<IssueMeta>;
}

export interface GitSource {
  readFileAtRef(repo: RepoRef, ref: string, path: string, maxBytes: number): Promise<ReadFileAtRefResult>;
  fetchPullHead(repo: RepoRef, number: number, opts?: { signal?: AbortSignal }): Promise<void>;
}

export interface ModelsPort {
  /** Always resolved per call: a Settings change applies to the next derivation. */
  resolve(workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice>;
  llm(provider: FeatureModelChoice['provider']): Promise<LLMProvider>;
  /** True when the `review_intent` provider can be constructed (no model call). */
  isConfigured(workspaceId: string): Promise<boolean>;
}

export interface SettingsPort {
  /** Effective workspace `automatic_brief` (missing row = true). */
  autoBrief(workspaceId: string): Promise<boolean>;
}

export interface JobsPort {
  enqueue(workspaceId: string, payload: DerivePayload): Promise<{ done: Promise<void> }>;
}

export interface DiffParser {
  parse(raw: string): UnifiedDiff;
}

export interface BriefLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

// ---- persistence ---------------------------------------------------------------
export interface CostPair {
  costUsd: number | null;
  costSource: CostSource | null;
}

export interface IntentWrite extends CostPair {
  headSha: string;
  intent: string;
  inScope: string[];
  outOfScope: string[];
  confidence: IntentConfidence;
  sources: IntentSource[];
  unresolvedLinks: UnresolvedLink[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface RisksWrite extends CostPair {
  headSha: string;
  risks: Risk[];
  droppedRefs: number;
  ruleOnly: boolean;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** An open PR lacking an intent and/or a risks row for its current head. */
export interface ScheduleCandidate {
  prId: string;
  headSha: string;
  hasIntent: boolean;
  hasRisks: boolean;
}

export interface BriefStore {
  getIntent(prId: string): Promise<PrIntentRecord | undefined>;
  getRisks(prId: string): Promise<PrRisksRecord | undefined>;
  upsertIntent(prId: string, write: IntentWrite): Promise<void>;
  upsertRisks(prId: string, write: RisksWrite): Promise<void>;
  /**
   * Open PRs of the repo (workspace-scoped) with no intent OR no risks row for
   * their current head, newest `updated_at` first. NO LIMIT: the service drops
   * queued / running / negative-cached PRs first, then takes the first N.
   */
  listScheduleCandidates(workspaceId: string, repoId: string): Promise<ScheduleCandidate[]>;
}
