/**
 * INFRASTRUCTURE — Drizzle implementation of `ConventionStore`. The only file
 * of the module that imports `drizzle-orm` or `db/**`. Rows are mapped to
 * domain shapes here and never leave the file.
 *
 * Skill and agent tables stay owned by their modules: inside a transaction the
 * skill insert and the agent's linked skills go through the tx-bound
 * repositories the container builds (`skillsRepoOn(tx)`, `agentsRepoOn(tx)`),
 * handed in by `wiring.ts`. Only the lock and the link append are written here.
 */
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionEvidenceRow } from '../../db/schema/knowledge.js';
import type { Container } from '../../platform/container.js';
import {
  ScanRunningError,
  type ConventionEvidence,
  type ConventionRecord,
  type ConventionsPageData,
  type ConventionView,
  type ConventionWrite,
  type CreatedSkill,
  type MergedObservation,
  type PriorIdentity,
  type RepoInfo,
  type ScanRecord,
} from './domain.js';
import type { AgentLinkState, ConventionStore, NewExtractedSkill, ScanCompletion } from './ports.js';

type ScanRow = typeof t.conventionScans.$inferSelect;
type ConventionRow = typeof t.conventions.$inferSelect;
type ObservationRow = typeof t.conventionObservations.$inferSelect;

/** Tx-bound repositories of the modules that own skills and agents (built by the container). */
export interface TxRepositories {
  skillsOn(tx: DbTx): Pick<ReturnType<Container['skillsRepoOn']>, 'insert'>;
  agentsOn(tx: DbTx): Pick<ReturnType<Container['agentsRepoOn']>, 'linkedSkills'>;
}

const RUNNING_SCAN_UQ = 'convention_scans_repo_running_uq';

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint_name?: unknown }).constraint_name === constraint
  );
}

function toScan(r: ScanRow): ScanRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    repoId: r.repoId,
    status: r.status,
    jobId: r.jobId,
    attempt: r.attempt,
    commitSha: r.commitSha,
    sampleFileCount: r.sampleFileCount,
    foundCount: r.foundCount,
    verifiedCount: r.verifiedCount,
    droppedCount: r.droppedCount,
    relocatedCount: r.relocatedCount,
    matchedPriorCount: r.matchedPriorCount,
    duplicateCount: r.duplicateCount,
    retryCount: r.retryCount,
    model: r.model,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: r.costUsd,
    costSource: r.costSource,
    error: r.error,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

function toConvention(r: ConventionRow): ConventionRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    repoId: r.repoId,
    fingerprint: r.fingerprint,
    category: r.category,
    origin: r.origin,
    rule: r.rule,
    originalRule: r.originalRule,
    status: r.status,
    editedAt: r.editedAt,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
    lastSeenScanId: r.lastSeenScanId,
  };
}

function toEvidence(e: ConventionEvidenceRow): ConventionEvidence {
  return { path: e.path, lineStart: e.line_start, lineEnd: e.line_end, snippet: e.snippet };
}

function toEvidenceRow(e: ConventionEvidence): ConventionEvidenceRow {
  return { path: e.path, line_start: e.lineStart, line_end: e.lineEnd, snippet: e.snippet };
}

function toObservationView(o: ObservationRow) {
  return {
    evidence: o.evidence.map(toEvidence),
    supportCount: o.supportCount,
    counterCount: o.counterCount,
    reviewHits: o.reviewHits,
    confidence: o.confidence,
  };
}

export class ConventionsRepository implements ConventionStore {
  constructor(
    private readonly db: Db | DbTx,
    private readonly txRepos: TxRepositories,
    /** Set only on the instance `transaction()` hands out. */
    private readonly tx?: DbTx,
  ) {}

  private requireTx(): DbTx {
    if (!this.tx) throw new Error('ConventionsRepository: this write must run inside transaction()');
    return this.tx;
  }

  // ------------------------------------------------------------ repo + scans

  async findRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async findRunningScan(repoId: string): Promise<ScanRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(and(eq(t.conventionScans.repoId, repoId), eq(t.conventionScans.status, 'running')))
      .limit(1);
    return row ? toScan(row) : undefined;
  }

  async insertRunningScan(workspaceId: string, repoId: string): Promise<ScanRecord> {
    try {
      const [row] = await this.db
        .insert(t.conventionScans)
        .values({ workspaceId, repoId, status: 'running' })
        .returning();
      if (!row) throw new Error('insert into convention_scans returned no row');
      return toScan(row);
    } catch (err) {
      if (!isUniqueViolation(err, RUNNING_SCAN_UQ)) throw err;
      const running = await this.findRunningScan(repoId);
      throw new ScanRunningError(running?.id ?? '');
    }
  }

  async setScanJob(scanId: string, jobId: string): Promise<void> {
    await this.db.update(t.conventionScans).set({ jobId }).where(eq(t.conventionScans.id, scanId));
  }

  async bumpAttempt(scanId: string): Promise<ScanRecord | undefined> {
    const [row] = await this.db
      .update(t.conventionScans)
      .set({ attempt: sql`${t.conventionScans.attempt} + 1` })
      .where(and(eq(t.conventionScans.id, scanId), eq(t.conventionScans.status, 'running')))
      .returning();
    return row ? toScan(row) : undefined;
  }

  private ownedBy(scanId: string, attempt: number) {
    return and(
      eq(t.conventionScans.id, scanId),
      eq(t.conventionScans.status, 'running'),
      eq(t.conventionScans.attempt, attempt),
    );
  }

  async setScanCommit(scanId: string, attempt: number, commitSha: string): Promise<boolean> {
    const rows = await this.db
      .update(t.conventionScans)
      .set({ commitSha })
      .where(this.ownedBy(scanId, attempt))
      .returning({ id: t.conventionScans.id });
    return rows.length > 0;
  }

  async failScan(scanId: string, error: string, attempt?: number): Promise<boolean> {
    const where =
      attempt !== undefined
        ? this.ownedBy(scanId, attempt)
        : and(eq(t.conventionScans.id, scanId), eq(t.conventionScans.status, 'running'));
    const rows = await this.db
      .update(t.conventionScans)
      .set({
        status: 'failed',
        error,
        finishedAt: new Date(),
        retryCount: sql`greatest(${t.conventionScans.attempt} - 1, 0)`,
      })
      .where(where)
      .returning({ id: t.conventionScans.id });
    return rows.length > 0;
  }

  async reapRunningScans(error: string): Promise<number> {
    const rows = await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(eq(t.conventionScans.status, 'running'))
      .returning({ id: t.conventionScans.id });
    return rows.length;
  }

  // ------------------------------------------------------------ identities (reads)

  async listPrior(repoId: string, limit: number): Promise<PriorIdentity[]> {
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.repoId, repoId),
          or(inArray(t.conventions.status, ['accepted', 'rejected']), isNotNull(t.conventions.editedAt)),
        ),
      )
      .orderBy(
        desc(sql`coalesce(${t.conventions.decidedAt}, ${t.conventions.editedAt}, ${t.conventions.createdAt})`),
        desc(t.conventions.id),
      )
      .limit(limit);
    return rows.map((r, i) => ({
      ref: `P${i + 1}`,
      id: r.id,
      status: r.status,
      category: r.category,
      rule: r.rule,
    }));
  }

  private async latestScan(repoId: string, status?: 'running' | 'done'): Promise<ScanRecord | null> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        status
          ? and(eq(t.conventionScans.repoId, repoId), eq(t.conventionScans.status, status))
          : eq(t.conventionScans.repoId, repoId),
      )
      .orderBy(desc(t.conventionScans.startedAt))
      .limit(1);
    return row ? toScan(row) : null;
  }

  /** Identities + last observation + that scan's SHA + skills. CQRS-lite read. */
  private async loadViews(workspaceId: string, where: ReturnType<typeof and>): Promise<ConventionView[]> {
    const rows = await this.db
      .select({ c: t.conventions, o: t.conventionObservations, sha: t.conventionScans.commitSha })
      .from(t.conventions)
      .leftJoin(
        t.conventionObservations,
        and(
          eq(t.conventionObservations.conventionId, t.conventions.id),
          eq(t.conventionObservations.scanId, t.conventions.lastSeenScanId),
        ),
      )
      .leftJoin(t.conventionScans, eq(t.conventionScans.id, t.conventions.lastSeenScanId))
      .where(and(eq(t.conventions.workspaceId, workspaceId), where));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.c.id);
    const links = await this.db
      .select({ conventionId: t.conventionSkills.conventionId, id: t.skills.id, name: t.skills.name })
      .from(t.conventionSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.conventionSkills.skillId))
      .where(and(inArray(t.conventionSkills.conventionId, ids), eq(t.skills.workspaceId, workspaceId)))
      .orderBy(t.skills.name);
    const skillsBy = new Map<string, { id: string; name: string }[]>();
    for (const l of links) {
      const list = skillsBy.get(l.conventionId) ?? [];
      list.push({ id: l.id, name: l.name });
      skillsBy.set(l.conventionId, list);
    }

    return rows.map((r) => ({
      ...toConvention(r.c),
      observation: r.o ? toObservationView(r.o) : null,
      lastSeenCommitSha: r.sha ?? null,
      skills: skillsBy.get(r.c.id) ?? [],
    }));
  }

  async getPage(workspaceId: string, repoId: string): Promise<ConventionsPageData> {
    const [lastScan, runningScan, latestDoneScan, candidates] = await Promise.all([
      this.latestScan(repoId),
      this.latestScan(repoId, 'running'),
      this.latestScan(repoId, 'done'),
      this.loadViews(workspaceId, and(eq(t.conventions.repoId, repoId))),
    ]);
    return { lastScan, runningScan, latestDoneScan, candidates };
  }

  async getCandidate(workspaceId: string, id: string): Promise<ConventionView | undefined> {
    const [view] = await this.loadViews(workspaceId, and(eq(t.conventions.id, id)));
    return view;
  }

  async latestDoneScanId(repoId: string): Promise<string | null> {
    return (await this.latestScan(repoId, 'done'))?.id ?? null;
  }

  async findConventionForUpdate(workspaceId: string, id: string): Promise<ConventionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .for('update');
    return row ? toConvention(row) : undefined;
  }

  async updateConvention(workspaceId: string, id: string, write: ConventionWrite): Promise<void> {
    await this.db
      .update(t.conventions)
      .set({
        ...(write.status !== undefined ? { status: write.status } : {}),
        ...(write.rule !== undefined ? { rule: write.rule } : {}),
        ...(write.category !== undefined ? { category: write.category } : {}),
        ...(write.editedAt !== undefined ? { editedAt: write.editedAt } : {}),
        ...(write.decidedAt !== undefined ? { decidedAt: write.decidedAt } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
  }

  // ------------------------------------------------------------ PERSIST

  async identityIndex(repoId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: t.conventions.id, fingerprint: t.conventions.fingerprint })
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId));
    return new Map(rows.map((r) => [r.fingerprint, r.id]));
  }

  async completeScan(scanId: string, attempt: number, s: ScanCompletion): Promise<boolean> {
    const rows = await this.db
      .update(t.conventionScans)
      .set({
        status: 'done',
        finishedAt: new Date(),
        error: null,
        sampleFileCount: s.sampleFileCount,
        foundCount: s.foundCount,
        verifiedCount: s.verifiedCount,
        droppedCount: s.droppedCount,
        relocatedCount: s.relocatedCount,
        matchedPriorCount: s.matchedPriorCount,
        duplicateCount: s.duplicateCount,
        retryCount: s.retryCount,
        model: s.model,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        costUsd: s.costUsd,
        costSource: s.costSource,
      })
      .where(this.ownedBy(scanId, attempt))
      .returning({ id: t.conventionScans.id });
    return rows.length > 0;
  }

  async upsertIdentity(input: {
    workspaceId: string;
    repoId: string;
    observation: MergedObservation;
    scanId: string;
  }): Promise<string> {
    const o = input.observation;
    const [row] = await this.db
      .insert(t.conventions)
      .values({
        workspaceId: input.workspaceId,
        repoId: input.repoId,
        fingerprint: o.fingerprint,
        category: o.category,
        origin: o.origin,
        rule: o.rule,
        originalRule: o.rule,
        status: 'pending',
        lastSeenScanId: input.scanId,
      })
      .onConflictDoUpdate({
        target: [t.conventions.repoId, t.conventions.fingerprint],
        set: { lastSeenScanId: input.scanId },
      })
      .returning({ id: t.conventions.id });
    if (!row) throw new Error('upsert into conventions returned no row');
    return row.id;
  }

  async insertObservation(scanId: string, conventionId: string, o: MergedObservation): Promise<void> {
    await this.db.insert(t.conventionObservations).values({
      scanId,
      conventionId,
      evidence: o.evidence.map(toEvidenceRow),
      supportCount: o.supportCount,
      counterCount: o.counterCount,
      reviewHits: o.reviewHits,
      llmConfidence: o.llmConfidence,
      confidence: o.confidence,
      relocated: o.relocated,
    });
  }

  async markSeen(conventionIds: string[], scanId: string): Promise<void> {
    if (conventionIds.length === 0) return;
    await this.db
      .update(t.conventions)
      .set({ lastSeenScanId: scanId })
      .where(inArray(t.conventions.id, conventionIds));
  }

  async applyRetention(repoId: string, keep: number): Promise<number> {
    const s = t.conventionScans;
    const rows = await this.db
      .delete(s)
      .where(
        and(
          eq(s.repoId, repoId),
          ne(s.status, 'running'),
          sql`${s.id} NOT IN (SELECT keep.id FROM ${s} AS keep WHERE keep.repo_id = ${repoId} ORDER BY keep.started_at DESC LIMIT ${keep})`,
          sql`NOT EXISTS (SELECT 1 FROM ${t.conventions} WHERE ${t.conventions.lastSeenScanId} = ${s.id})`,
        ),
      )
      .returning({ id: s.id });
    return rows.length;
  }

  // ------------------------------------------------------------ skill creation

  async lockConventions(workspaceId: string, repoId: string, ids: string[]): Promise<ConventionRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      )
      .orderBy(t.conventions.id)
      .for('share');
    return rows.map(toConvention);
  }

  async lastEvidence(conventionIds: string[]): Promise<ConventionEvidence[]> {
    if (conventionIds.length === 0) return [];
    const rows = await this.db
      .select({ evidence: t.conventionObservations.evidence })
      .from(t.conventions)
      .innerJoin(
        t.conventionObservations,
        and(
          eq(t.conventionObservations.conventionId, t.conventions.id),
          eq(t.conventionObservations.scanId, t.conventions.lastSeenScanId),
        ),
      )
      .where(inArray(t.conventions.id, conventionIds));
    return rows.flatMap((r) => r.evidence.map(toEvidence));
  }

  async lockAgents(workspaceId: string, agentIds: string[]): Promise<string[]> {
    if (agentIds.length === 0) return [];
    const rows = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, agentIds)))
      .orderBy(t.agents.id)
      .for('update');
    return rows.map((r) => r.id);
  }

  async insertSkill(input: NewExtractedSkill): Promise<CreatedSkill> {
    const skill = await this.txRepos.skillsOn(this.requireTx()).insert({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      type: 'convention',
      source: 'extracted',
      body: input.body,
      enabled: input.enabled,
      needsVetting: input.needsVetting,
      vettedBodyHash: input.vettedBodyHash,
      evidenceFiles: input.evidenceFiles,
    });
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      type: skill.type,
      source: skill.source,
      body: skill.body,
      enabled: skill.enabled,
      version: skill.version,
      evidenceFiles: skill.evidenceFiles,
      needsVetting: skill.needsVetting,
      updatedAt: skill.updatedAt,
    };
  }

  async agentLinkState(agentId: string): Promise<AgentLinkState> {
    const linked = await this.txRepos.agentsOn(this.requireTx()).linkedSkills(agentId);
    return {
      links: linked.map((l) => ({ skillId: l.skill.id, enabled: l.enabled })),
      skills: linked.map((l) => ({ id: l.skill.id, enabled: l.skill.enabled, body: l.skill.body })),
      maxOrder: linked.reduce((max, l) => Math.max(max, l.order), -1),
    };
  }

  async appendAgentLink(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db.insert(t.agentSkills).values({ agentId, skillId, order, enabled: true });
  }

  async linkConventionsToSkill(conventionIds: string[], skillId: string): Promise<void> {
    if (conventionIds.length === 0) return;
    await this.db
      .insert(t.conventionSkills)
      .values(conventionIds.map((conventionId) => ({ conventionId, skillId })))
      .onConflictDoNothing();
  }

  /** Nested calls reuse the outer transaction (Drizzle savepoint). */
  transaction<T>(work: (store: ConventionStore) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new ConventionsRepository(tx, this.txRepos, tx)));
  }
}
