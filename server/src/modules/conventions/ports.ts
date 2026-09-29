/**
 * PORTS — what the conventions service needs from the outside, declared by the
 * inner ring. `repository.ts` implements `ConventionStore` with Drizzle;
 * `wiring.ts` adapts the container (git, repo-intel, reviews, LLM, jobs, fs
 * guard) to the narrow ports below; `service.test.ts` fakes all of them.
 */
import type { CostSource, LLMProvider, Provider, RepoRef } from '@devdigest/shared';
import type {
  ConventionEvidence,
  ConventionRecord,
  ConventionsPageData,
  ConventionView,
  ConventionWrite,
  CreatedSkill,
  MergedObservation,
  PriorIdentity,
  RepoInfo,
  ScanRecord,
} from './domain.js';

/** Stats written by the compare-and-set that completes a scan (AC-23). */
export interface ScanCompletion {
  sampleFileCount: number;
  foundCount: number;
  verifiedCount: number;
  droppedCount: number;
  relocatedCount: number;
  matchedPriorCount: number;
  duplicateCount: number;
  retryCount: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  costSource: CostSource | null;
}

/**
 * What an attempt has counted so far. Written before an attempt rethrows, so a
 * scan that ends `failed` still shows how far it got (AC-23).
 */
export type ScanProgress = Partial<Omit<ScanCompletion, 'retryCount'>>;

export interface NewExtractedSkill {
  workspaceId: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  needsVetting: boolean;
  vettedBodyHash: string | null;
  evidenceFiles: string[];
}

/** An agent's current links, for the budget check and the next `order`. */
export interface AgentLinkState {
  links: { skillId: string; enabled: boolean }[];
  skills: { id: string; enabled: boolean; body: string }[];
  maxOrder: number;
}

export interface ConventionStore {
  // ---- repo + scans
  findRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined>;
  findRunningScan(repoId: string): Promise<ScanRecord | undefined>;
  /** Insert a `running` scan. Throws `ScanRunningError` on the running-scan unique index (23505). */
  insertRunningScan(workspaceId: string, repoId: string): Promise<ScanRecord>;
  setScanJob(scanId: string, jobId: string): Promise<void>;
  /** attempt += 1 while the scan is still running; undefined when it is not. */
  bumpAttempt(scanId: string): Promise<ScanRecord | undefined>;
  /** Pin HEAD on the scan, guarded by `status='running' AND attempt=?`. */
  setScanCommit(scanId: string, attempt: number, commitSha: string): Promise<boolean>;
  /** Write the stats an attempt has so far, guarded by `status='running' AND attempt=?`. */
  recordScanProgress(scanId: string, attempt: number, progress: ScanProgress): Promise<boolean>;
  /** Mark failed. With `attempt`, only if that attempt still owns the row. */
  failScan(scanId: string, error: string, attempt?: number): Promise<boolean>;
  /** Boot-time reaper (AC-18): every `running` scan becomes `failed`. */
  reapRunningScans(error: string): Promise<number>;

  // ---- identities
  /** Decided identities (accepted / rejected / edited), newest decision first, with `P1..Pn` refs. */
  listPrior(repoId: string, limit: number): Promise<PriorIdentity[]>;
  getPage(workspaceId: string, repoId: string): Promise<ConventionsPageData>;
  getCandidate(workspaceId: string, id: string): Promise<ConventionView | undefined>;
  latestDoneScanId(repoId: string): Promise<string | null>;
  /** Lock the identity row for a decision update. */
  findConventionForUpdate(workspaceId: string, id: string): Promise<ConventionRecord | undefined>;
  updateConvention(workspaceId: string, id: string, write: ConventionWrite): Promise<void>;

  // ---- PERSIST (inside `transaction`)
  identityIndex(repoId: string): Promise<Map<string, string>>;
  /** CAS `status='running' AND attempt=?` → done + stats. False when another attempt owns the row. */
  completeScan(scanId: string, attempt: number, stats: ScanCompletion): Promise<boolean>;
  /** Insert a new identity (pending) or return the id already holding that fingerprint. */
  upsertIdentity(input: {
    workspaceId: string;
    repoId: string;
    observation: MergedObservation;
    scanId: string;
  }): Promise<string>;
  insertObservation(scanId: string, conventionId: string, observation: MergedObservation): Promise<void>;
  markSeen(conventionIds: string[], scanId: string): Promise<void>;
  /** Keep the newest `keep` scans of the repo plus every scan an identity still references. */
  applyRetention(repoId: string, keep: number): Promise<number>;

  // ---- skill creation (inside `transaction`)
  /** Conventions among `ids` in this workspace AND repo, locked FOR SHARE; foreign ids are absent. */
  lockConventions(workspaceId: string, repoId: string, ids: string[]): Promise<ConventionRecord[]>;
  /** Evidence of each convention's last observation. */
  lastEvidence(conventionIds: string[]): Promise<ConventionEvidence[]>;
  /** `SELECT … FROM agents … FOR UPDATE`; returns the ids found in this workspace. */
  lockAgents(workspaceId: string, agentIds: string[]): Promise<string[]>;
  /** Inserts through the skills repository bound to this transaction. Throws `skill_name_taken` (409). */
  insertSkill(input: NewExtractedSkill): Promise<CreatedSkill>;
  agentLinkState(agentId: string): Promise<AgentLinkState>;
  appendAgentLink(agentId: string, skillId: string, order: number): Promise<void>;
  linkConventionsToSkill(conventionIds: string[], skillId: string): Promise<void>;

  /** Run `work` atomically; use the store handed to `work`, not `this`. */
  transaction<T>(work: (store: ConventionStore) => Promise<T>): Promise<T>;
}

export interface RepoIndexPort {
  indexStatus(repoId: string): Promise<string>;
  topFilesByRank(repoId: string, n: number): Promise<string[]>;
}

export interface RecurringFindingsPort {
  recurringFindings(
    repoId: string,
    minPrs: number,
    limit: number,
  ): Promise<{ category: string; title: string; prCount: number; files: string[] }[]>;
}

/** Repo files on disk. Every read goes through `assertSafe` first (AC-11). */
export interface RepoFilesPort {
  cloneRoot(ref: RepoRef): string;
  cloneExists(ref: RepoRef): Promise<boolean>;
  /** Throws `UnsafePathError` for `..`, absolute, NUL or a symlink escaping `root`. */
  assertSafe(root: string, relPath: string): Promise<void>;
  readFile(ref: RepoRef, relPath: string): Promise<string>;
  currentHead(ref: RepoRef): Promise<string>;
}

export interface ModelPort {
  resolve(workspaceId: string): Promise<{ provider: Provider; model: string }>;
  llm(provider: Provider): Promise<LLMProvider>;
}

export interface ScanJobsPort {
  enqueue(workspaceId: string, payload: { scanId: string }): Promise<{ id: string; done: Promise<void> }>;
}

export interface ConventionsDeps {
  store: ConventionStore;
  repoIndex: RepoIndexPort;
  reviews: RecurringFindingsPort;
  files: RepoFilesPort;
  models: ModelPort;
  jobs: ScanJobsPort;
  /** Scan deadline (AC-17); tests shorten it. */
  deadlineMs?: number;
  now?: () => Date;
  onJobError?: (scanId: string, err: unknown) => void;
}
