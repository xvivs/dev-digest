/**
 * INFRASTRUCTURE — Drizzle persistence for the brief module. Owns `pr_intent`
 * and `pr_risks` only (blast / history caches belong to their own modules).
 * Rows never leave this file: they are mapped to the shared records here.
 *
 * `cost_usd` / `cost_source` are a pair (ADR 0002): `costPair` is the single
 * write path, so a half-set pair cannot be stored.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PrIntentRecord, PrRisksRecord, Provider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  BriefSettingsStore,
  BriefStore,
  CostPair,
  IntentWrite,
  RisksWrite,
  ScheduleCandidate,
} from './ports.js';

/**
 * The raw stored `settings.automatic_brief` for a workspace, `undefined` when no
 * row exists. The default is applied by the domain's `resolveAutomaticBrief`.
 * Read per call so a Settings toggle applies without a restart.
 */
export async function readAutomaticBriefSetting(db: Db, workspaceId: string): Promise<unknown> {
  const [row] = await db
    .select({ value: t.settings.value })
    .from(t.settings)
    .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'automatic_brief')));
  return row?.value;
}

function costPair(c: CostPair): { costUsd: number | null; costSource: CostPair['costSource'] } {
  return c.costUsd === null || c.costSource === null
    ? { costUsd: null, costSource: null }
    : { costUsd: c.costUsd, costSource: c.costSource };
}

const asProvider = (p: string | null): Provider | null =>
  p === 'openai' || p === 'anthropic' || p === 'openrouter' ? p : null;

function toIntentRecord(r: typeof t.prIntent.$inferSelect): PrIntentRecord {
  return {
    pr_id: r.prId,
    intent: r.intent,
    in_scope: r.inScope,
    out_of_scope: r.outOfScope,
    head_sha: r.headSha,
    confidence: r.confidence,
    sources: r.sources,
    unresolved_links: r.unresolvedLinks,
    provider: asProvider(r.provider),
    model: r.model,
    tokens_in: r.tokensIn,
    tokens_out: r.tokensOut,
    cost_usd: r.costUsd,
    cost_source: r.costSource,
    derived_at: r.derivedAt.toISOString(),
  };
}

function toRisksRecord(r: typeof t.prRisks.$inferSelect): PrRisksRecord {
  return {
    pr_id: r.prId,
    head_sha: r.headSha,
    risks: r.risks,
    dropped_refs: r.droppedRefs,
    rule_only: r.ruleOnly,
    provider: asProvider(r.provider),
    model: r.model,
    tokens_in: r.tokensIn,
    tokens_out: r.tokensOut,
    cost_usd: r.costUsd,
    cost_source: r.costSource,
    derived_at: r.derivedAt.toISOString(),
  };
}

export class BriefRepository implements BriefStore, BriefSettingsStore {
  constructor(private db: Db) {}

  async getIntent(prId: string): Promise<PrIntentRecord | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row ? toIntentRecord(row) : undefined;
  }

  async getRisks(prId: string): Promise<PrRisksRecord | undefined> {
    const [row] = await this.db.select().from(t.prRisks).where(eq(t.prRisks.prId, prId));
    return row ? toRisksRecord(row) : undefined;
  }

  async upsertIntent(prId: string, w: IntentWrite): Promise<void> {
    const values = {
      intent: w.intent,
      inScope: w.inScope,
      outOfScope: w.outOfScope,
      headSha: w.headSha,
      confidence: w.confidence,
      sources: w.sources,
      unresolvedLinks: w.unresolvedLinks,
      provider: w.provider,
      model: w.model,
      tokensIn: w.tokensIn,
      tokensOut: w.tokensOut,
      ...costPair(w),
      derivedAt: new Date(),
    };
    await this.db
      .insert(t.prIntent)
      .values({ prId, ...values })
      .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
  }

  async upsertRisks(prId: string, w: RisksWrite): Promise<void> {
    const values = {
      headSha: w.headSha,
      risks: w.risks,
      droppedRefs: w.droppedRefs,
      ruleOnly: w.ruleOnly,
      provider: w.provider,
      model: w.model,
      tokensIn: w.tokensIn,
      tokensOut: w.tokensOut,
      ...costPair(w),
      derivedAt: new Date(),
    };
    await this.db
      .insert(t.prRisks)
      .values({ prId, ...values })
      .onConflictDoUpdate({ target: t.prRisks.prId, set: values });
  }

  readAutomaticSetting(workspaceId: string): Promise<unknown> {
    return readAutomaticBriefSetting(this.db, workspaceId);
  }

  async listScheduleCandidates(workspaceId: string, repoId: string): Promise<ScheduleCandidate[]> {
    const rows = await this.db
      .select({
        prId: t.pullRequests.id,
        headSha: t.pullRequests.headSha,
        hasIntent: sql<boolean>`${t.prIntent.prId} is not null`,
        hasRisks: sql<boolean>`${t.prRisks.prId} is not null`,
      })
      .from(t.pullRequests)
      .leftJoin(
        t.prIntent,
        and(eq(t.prIntent.prId, t.pullRequests.id), eq(t.prIntent.headSha, t.pullRequests.headSha)),
      )
      .leftJoin(
        t.prRisks,
        and(eq(t.prRisks.prId, t.pullRequests.id), eq(t.prRisks.headSha, t.pullRequests.headSha)),
      )
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.status, 'open'),
          sql`(${t.prIntent.prId} is null or ${t.prRisks.prId} is null)`,
        ),
      )
      .orderBy(sql`${t.pullRequests.updatedAt} desc nulls last`, desc(t.pullRequests.number));
    return rows;
  }
}
