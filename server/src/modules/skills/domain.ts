/**
 * DOMAIN — the core ring of the `skills` module. Pure: no I/O, no container,
 * no Drizzle, no Fastify, no runtime zod. Only `import type` from
 * `@devdigest/shared` and the error taxonomy in `platform/errors.ts`.
 *
 * Encodes ADR 0012 (trust tiers): an imported skill always starts disabled
 * and unvetted; editing an imported skill's body resets vetting; enabling a
 * skill that still needs vetting is refused.
 */
import type {
  CostSource,
  ImpactVerdict,
  SkillAgentUsageStatus,
  SkillSource,
  SkillStatsWindow,
  SkillType,
} from '@devdigest/shared';
import { AppError, ValidationError } from '../../platform/errors.js';
import {
  INVISIBLE_CHARS_PATTERN,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_PATTERN,
} from './constants.js';

/** What the service reads and writes. Not a Drizzle row, not an HTTP DTO. */
export interface Skill {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  version: number;
  evidenceFiles: string[] | null;
  needsVetting: boolean;
  vettedBodyHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Latest Full-suite verdict for the skill card (ADR 0017). Phase 3 fills it. */
export interface SkillLatestVerdict {
  verdict: ImpactVerdict;
  carrierName: string;
  stale: boolean;
}

/** A skill plus how many agents link it, its completed runs over the last
 *  30 days and its latest Full eval verdict (`GET /skills` row). */
export interface SkillListItem extends Skill {
  agentCount: number;
  runs30d: number;
  /** null = no evals. Always null until the Phase 3 eval tables exist. */
  latestVerdict: SkillLatestVerdict | null;
}

export interface NewSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  /** Resolved by `applyImportPolicy` — never trusted from the client on import. */
  enabled: boolean;
  needsVetting: boolean;
}

/** Fields the API allows a PUT to change (D8: partial body). */
export interface SkillPatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** ADR 0016: free-text "what changed", stored on the new snapshot only. */
  changeNote?: string;
}

/**
 * ADR 0016: one append-only `skill_versions` row = the state of every
 * versioned field at `version`. `name`/`description`/`type` are null on
 * snapshots written before the all-field migration (only the body was kept).
 */
export interface SkillVersionSnapshot {
  skillId: string;
  version: number;
  name: string | null;
  description: string | null;
  type: SkillType | null;
  body: string;
  changeNote: string | null;
  createdAt: Date;
}

/** `GET /skills/:id/versions` row: the snapshot without its body. */
export type SkillVersionSummary = Omit<SkillVersionSnapshot, 'body'>;

/** The versioned content fields (ADR 0016). `enabled` is deliberately absent. */
export type SkillContent = Pick<Skill, 'name' | 'description' | 'type' | 'body'>;

/**
 * ADR 0016: a change to any of name/description/type/body bumps the version
 * and writes a snapshot; toggling `enabled` never does. Returns the fields
 * of `patch` that actually differ from `current`.
 */
export function changedContent(
  current: SkillContent,
  patch: Partial<SkillContent>,
): Partial<SkillContent> {
  const out: Partial<SkillContent> = {};
  if (patch.name !== undefined && patch.name !== current.name) out.name = patch.name;
  if (patch.description !== undefined && patch.description !== current.description) {
    out.description = patch.description;
  }
  if (patch.type !== undefined && patch.type !== current.type) out.type = patch.type;
  if (patch.body !== undefined && patch.body !== current.body) out.body = patch.body;
  return out;
}

/**
 * ADR 0016: the content a restore of `snapshot` would write. A legacy snapshot
 * (null metadata) restores its body only and keeps the current metadata.
 */
export function restoreTarget(snapshot: SkillVersionSnapshot): Partial<SkillContent> {
  return {
    ...(snapshot.name !== null ? { name: snapshot.name } : {}),
    ...(snapshot.description !== null ? { description: snapshot.description } : {}),
    ...(snapshot.type !== null ? { type: snapshot.type } : {}),
    body: snapshot.body,
  };
}

/** Default note on a version created by `POST …/versions/:v/restore`. */
export function restoreChangeNote(version: number): string {
  return `Restored from v${version}`;
}

/** Empty / whitespace-only notes are stored as null. */
export function normalizeChangeNote(note: string | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

/**
 * ADR 0012 input limits apply to a restore as to a PUT: a snapshot written
 * under looser rules (or tampered with in the DB) must not come back in.
 * Throws a 422 `validation_error` naming the offending field.
 */
export function assertRestorableContent(content: Partial<SkillContent>): void {
  const fail = (field: string, reason: string): never => {
    throw new ValidationError(`Snapshot ${field} cannot be restored: ${reason}`, { field });
  };
  if (content.name !== undefined && !SKILL_NAME_PATTERN.test(content.name)) {
    fail('name', 'not a lowercase slug');
  }
  if (content.description !== undefined && content.description.length > SKILL_DESCRIPTION_MAX) {
    fail('description', `longer than ${SKILL_DESCRIPTION_MAX} chars`);
  }
  if (content.body !== undefined) {
    if (content.body.length < 1 || content.body.length > SKILL_BODY_MAX) {
      fail('body', `must be 1..${SKILL_BODY_MAX} chars`);
    }
    if (containsInvisibleChars(content.body)) fail('body', 'contains disallowed invisible characters');
  }
}

export function containsInvisibleChars(body: string): boolean {
  return INVISIBLE_CHARS_PATTERN.test(body);
}

export class SkillNameTakenError extends AppError {
  constructor(name: string) {
    super('skill_name_taken', `A skill named "${name}" already exists in this workspace`, 409, {
      name,
    });
  }
}

/** The body changed after the person opened "Review & trust" (ADR 0012). */
export class SkillVetStaleError extends AppError {
  constructor(expected: number, actual: number) {
    super(
      'skill_vet_stale',
      'The skill changed while you were reviewing it. Review the current body again.',
      409,
      { expected_version: expected, current_version: actual },
    );
  }
}

/** ADR 0016: the skill moved past the version the client restored from. */
export class SkillVersionStaleError extends AppError {
  constructor(expected: number, actual: number) {
    super(
      'skill_version_stale',
      'The skill changed since you opened its history. Reload and try again.',
      409,
      { expected_version: expected, current_version: actual },
    );
  }
}

export class SkillVersionNotFoundError extends AppError {
  constructor(version: number) {
    super('not_found', `Skill version ${version} not found`, 404, { version });
  }
}

export class SkillNotVettedError extends AppError {
  constructor() {
    super('skill_not_vetted', 'Skill must be vetted first', 409);
  }
}

/**
 * ADR 0012 tiers: a manual skill is trusted on save. An imported skill always
 * starts disabled and unvetted, whatever the request asked for — the caller
 * (service) must never forward a client-supplied `enabled`/`needs_vetting` for
 * an import.
 */
export function applyImportPolicy(source: SkillSource): { enabled: boolean; needsVetting: boolean } {
  if (source === 'manual') return { enabled: true, needsVetting: false };
  return { enabled: false, needsVetting: true };
}

export interface VettingTransition {
  needsVetting: boolean;
  vettedBodyHash: string | null;
}

/**
 * ADR 0012: editing the body of an IMPORTED skill resets vetting — the body a
 * person vetted is no longer the body that would ship. `bodyChanged` is
 * decided by the caller (it already has old + new body in hand); a manual
 * skill's `needsVetting` never flips true here (manual skills are trusted on
 * save and have no vetting workflow).
 */
export function resolveVettingOnBodyEdit(
  existing: Pick<Skill, 'source' | 'needsVetting' | 'vettedBodyHash'>,
  bodyChanged: boolean,
): VettingTransition {
  if (bodyChanged && existing.source === 'imported') {
    return { needsVetting: true, vettedBodyHash: null };
  }
  return { needsVetting: existing.needsVetting, vettedBodyHash: existing.vettedBodyHash };
}

/**
 * ADR 0012: a skill that still needs vetting cannot be enabled. Call this
 * AFTER `resolveVettingOnBodyEdit` so a same-request body edit that forces
 * `needsVetting: true` also blocks an `enabled: true` in that same patch.
 */
export function assertEnableAllowed(
  requestedEnabled: boolean | undefined,
  needsVettingAfterPatch: boolean,
): void {
  if (requestedEnabled === true && needsVettingAfterPatch) {
    throw new SkillNotVettedError();
  }
}


// ---------------------------------------------------------------------------
// Effectiveness + Stats (plan Phase 2, [F10])
// ---------------------------------------------------------------------------

/** The fields that decide whether a linked skill reaches an agent's prompt. */
export type SkillTrustState = Pick<Skill, 'source' | 'enabled' | 'needsVetting' | 'vettedBodyHash'>;

/**
 * Why a linked skill does or does not reach the agent's prompt. ONE rule for
 * the run-time resolver (`SkillsRepository.resolveEffectiveSkills`) and the
 * Stats tab, so the two can never disagree. `bodySha256` is sha256(current
 * body), computed by the caller (the domain does no hashing).
 *
 * Precedence: link_disabled > skill_disabled > blocked_by_vetting.
 * ADR 0012 defense in depth: an imported skill must also carry a vet that
 * matches its CURRENT body, whatever `needs_vetting` says.
 */
export function skillUsageStatus(
  linkEnabled: boolean,
  skill: SkillTrustState,
  bodySha256: string,
): SkillAgentUsageStatus {
  if (!linkEnabled) return 'link_disabled';
  if (!skill.enabled) return 'skill_disabled';
  if (skill.needsVetting) return 'blocked_by_vetting';
  if (skill.source !== 'manual' && skill.vettedBodyHash !== bodySha256) return 'blocked_by_vetting';
  return 'effective';
}

export function isEffectiveSkill(
  linkEnabled: boolean,
  skill: SkillTrustState,
  bodySha256: string,
): boolean {
  return skillUsageStatus(linkEnabled, skill, bodySha256) === 'effective';
}

/**
 * ADR 0017 `prompt_sha256 = sha256(name + body)`: the text hashed for it.
 * The newline mirrors how reviewer-core renders a skill (`### name\nbody`)
 * and keeps ("ab","c") and ("a","bc") apart. Names are slugs, so they never
 * contain a newline. The SQL twin lives in `repository.ts` (PROMPT_SHA256_SQL).
 */
export function promptHashInput(name: string, body: string): string {
  return `${name}\n${body}`;
}

/** Cost of `tokensIn` prompt tokens for `model`; null = no price entry. */
export type PriceEstimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

/** One `run_skills ⋈ agent_runs` group: completed runs of one agent at one
 *  skill version on one model, inside the window. */
export interface SkillRunAggregate {
  /** null when the agent was deleted after the run (`agent_runs.agent_id` SET NULL). */
  agentId: string | null;
  version: number;
  model: string | null;
  runs: number;
  tokens: number;
}

/** An agent linking the skill, with the status `skillUsageStatus` gives it. */
export interface LinkedAgentUsage {
  agentId: string;
  agentName: string;
  status: SkillAgentUsageStatus;
}

export interface CostFootprint {
  tokens: number;
  costUsd: number | null;
  costSource: CostSource | null;
}

export interface SkillStatsSummary {
  skillId: string;
  window: SkillStatsWindow;
  usage: { agents: (LinkedAgentUsage & { runs: number })[]; runs: number };
  cost: CostFootprint;
  byVersion: ({ version: number; runs: number } & CostFootprint)[];
  /** Phase 3 (evals) fills this; always null until then. */
  impact: null;
}

interface CostAcc {
  runs: number;
  tokens: number;
  costUsd: number;
  priced: boolean;
}

function addCost(acc: CostAcc, a: SkillRunAggregate, estimate: PriceEstimator): void {
  acc.runs += a.runs;
  acc.tokens += a.tokens;
  const cost = a.model ? estimate(a.model, a.tokens, 0) : null;
  if (cost !== null) {
    acc.costUsd += cost;
    acc.priced = true;
  }
}

function footprint(acc: CostAcc): CostFootprint {
  // ADR 0002: cost_usd and cost_source are null together. A group whose model
  // has no price adds tokens but no dollars; the total is null only when NO
  // group in the window had a price.
  return acc.priced
    ? { tokens: acc.tokens, costUsd: acc.costUsd, costSource: 'estimated' }
    : { tokens: acc.tokens, costUsd: null, costSource: null };
}

const emptyAcc = (): CostAcc => ({ runs: 0, tokens: 0, costUsd: 0, priced: false });

/**
 * Stats tab = Usage + Cost (plan Phase 2). Cost footprint = the skill's own
 * prompt tokens × the run model's INPUT price (the skill is prompt text, it
 * produces no output tokens of its own), so `cost_source` is always
 * `estimated`. Runs of agents that no longer link the skill still count
 * toward the totals and `by_version`; `usage.agents` lists current links only.
 */
export function summarizeSkillStats(input: {
  skillId: string;
  window: SkillStatsWindow;
  agents: LinkedAgentUsage[];
  aggregates: SkillRunAggregate[];
  estimate: PriceEstimator;
}): SkillStatsSummary {
  const total = emptyAcc();
  const byVersion = new Map<number, CostAcc>();
  const runsByAgent = new Map<string, number>();

  for (const a of input.aggregates) {
    addCost(total, a, input.estimate);
    const v = byVersion.get(a.version) ?? emptyAcc();
    addCost(v, a, input.estimate);
    byVersion.set(a.version, v);
    if (a.agentId) runsByAgent.set(a.agentId, (runsByAgent.get(a.agentId) ?? 0) + a.runs);
  }

  return {
    skillId: input.skillId,
    window: input.window,
    usage: {
      agents: input.agents.map((ag) => ({ ...ag, runs: runsByAgent.get(ag.agentId) ?? 0 })),
      runs: total.runs,
    },
    cost: footprint(total),
    byVersion: [...byVersion.entries()]
      .sort(([a], [b]) => b - a)
      .map(([version, acc]) => ({ version, runs: acc.runs, ...footprint(acc) })),
    impact: null,
  };
}
