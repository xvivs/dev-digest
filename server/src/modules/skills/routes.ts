/**
 * PRESENTATION — the HTTP driving adapter, and the only file Fastify sees.
 * parse (zod on the route) → service → DTO. No Drizzle, no `db/**`, no
 * repository, no business branching beyond mapping a service `undefined` to
 * `NotFoundError`.
 *
 *   GET    /skills?q=          → list (workspace-scoped, SkillListItem[])
 *   GET    /skills/:id         → one skill
 *   POST   /skills             → create (201)
 *   PUT    /skills/:id         → partial update (D8)
 *   DELETE /skills/:id         → hard delete (links cascade)
 *   POST   /skills/:id/vet     → ADR 0012 vetting
 *   GET    /skills/:id/versions              → snapshots, newest first (ADR 0016)
 *   GET    /skills/:id/versions/:version     → one snapshot with body
 *   POST   /skills/:id/versions/:version/restore → guarded, append-only restore
 *   GET    /skills/:id/stats?window=7d|30d|90d  → Usage + Cost (plan Phase 2)
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  RestoreSkillVersionBody,
  SkillChangeNote,
  SkillStatsQuery,
  type SkillListItem as SkillListItemDto,
  type SkillStats as SkillStatsDto,
  SkillType,
  type RestoreSkillVersionResult,
  type Skill as SkillDto,
  type SkillVersion as SkillVersionDto,
  type SkillVersionSummary as SkillVersionSummaryDto,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  containsInvisibleChars,
  type Skill,
  type SkillListItem,
  type SkillStatsSummary,
  type SkillVersionSnapshot,
  type SkillVersionSummary,
} from './domain.js';
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_PATTERN } from './constants.js';
import { buildSkillStatsService, buildSkillsService } from './wiring.js';

const INVISIBLE_CHARS_MESSAGE =
  'Body contains disallowed invisible/bidi-control characters (Unicode tags, bidi overrides, zero-width, BOM)';

const SkillName = z
  .string()
  .regex(SKILL_NAME_PATTERN, 'Name must be a lowercase slug: ^[a-z0-9][a-z0-9-]{1,63}$');

const SkillDescription = z.string().max(SKILL_DESCRIPTION_MAX);

const SkillBody = z
  .string()
  .min(1)
  .max(SKILL_BODY_MAX)
  .refine((body) => !containsInvisibleChars(body), { message: INVISIBLE_CHARS_MESSAGE });

/** Client can only ever create a 'manual' or 'imported' skill (ADR 0012). Not
 *  'imported_url' / 'community' — those are unused, no server-side fetch. */
const CreatableSkillSource = z.enum(['manual', 'imported']);

const CreateSkillBody = z
  .object({
    name: SkillName,
    description: SkillDescription.optional(),
    type: SkillType,
    body: SkillBody,
    source: CreatableSkillSource.default('manual'),
  })
  .strict();

/** CreateSkillBody minus `source` (not updatable) plus `enabled` (not
 *  creatable) and `change_note` (ADR 0016), all optional. `source` is omitted
 *  BEFORE `.partial()` so its `.default('manual')` never leaks into an update. */
const UpdateSkillBody = CreateSkillBody.omit({ source: true })
  .partial()
  .extend({ enabled: z.boolean().optional(), change_note: SkillChangeNote.optional() })
  .strict();

/** Same shape as `/agents/:id/versions/:version`: non-numeric → 422. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/** Public DTO (snake_case, ISO dates) — matches the frozen `Skill` contract. */
function toDto(s: Skill): SkillDto {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    type: s.type,
    source: s.source,
    body: s.body,
    enabled: s.enabled,
    version: s.version,
    evidence_files: s.evidenceFiles,
    needs_vetting: s.needsVetting,
    updated_at: s.updatedAt.toISOString(),
  };
}

function toVersionSummaryDto(v: SkillVersionSummary): SkillVersionSummaryDto {
  return {
    skill_id: v.skillId,
    version: v.version,
    name: v.name,
    description: v.description,
    type: v.type,
    change_note: v.changeNote,
    created_at: v.createdAt.toISOString(),
  };
}

function toVersionDto(v: SkillVersionSnapshot): SkillVersionDto {
  const { body, ...summary } = v;
  return { ...toVersionSummaryDto(summary), body };
}

function toListDto(s: SkillListItem): SkillListItemDto {
  return {
    ...toDto(s),
    agent_count: s.agentCount,
    runs_30d: s.runs30d,
    latest_verdict: s.latestVerdict
      ? {
          verdict: s.latestVerdict.verdict,
          carrier_name: s.latestVerdict.carrierName,
          stale: s.latestVerdict.stale,
        }
      : null,
  };
}

function toStatsDto(s: SkillStatsSummary): SkillStatsDto {
  return {
    skill_id: s.skillId,
    window: s.window,
    usage: {
      runs: s.usage.runs,
      agents: s.usage.agents.map((a) => ({
        agent_id: a.agentId,
        agent_name: a.agentName,
        status: a.status,
        runs: a.runs,
      })),
    },
    cost: { tokens: s.cost.tokens, cost_usd: s.cost.costUsd, cost_source: s.cost.costSource },
    by_version: s.byVersion.map((v) => ({
      version: v.version,
      runs: v.runs,
      tokens: v.tokens,
      cost_usd: v.costUsd,
      cost_source: v.costSource,
    })),
    impact: s.impact,
  };
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = buildSkillsService(app.container);
  const statsService = buildSkillStatsService(app.container);

  app.get('/skills', { schema: { querystring: z.object({ q: z.string().max(200).optional() }) } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const rows = await service.list(workspaceId, req.query.q);
    return rows.map(toListDto);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return toDto(skill);
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      type: body.type,
      body: body.body,
      source: body.source,
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
    reply.status(201);
    return toDto(skill);
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { change_note: changeNote, ...patch } = req.body;
      const skill = await service.update(workspaceId, req.params.id, {
        ...patch,
        ...(changeNote !== undefined ? { changeNote } : {}),
      });
      if (!skill) throw new NotFoundError('Skill not found');
      return toDto(skill);
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  // `version` = the version the person reviewed; a mismatch is 409 (ADR 0012).
  const VetSkillBody = z.object({ version: z.number().int().positive() }).strict();

  app.post('/skills/:id/vet', { schema: { params: IdParams, body: VetSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.vet(workspaceId, req.params.id, req.body.version);
    if (!skill) throw new NotFoundError('Skill not found');
    return toDto(skill);
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions.map(toVersionSummaryDto);
  });

  app.get('/skills/:id/versions/:version', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
    if (!version) throw new NotFoundError('Skill version not found');
    return toVersionDto(version);
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams, body: RestoreSkillVersionBody } },
    async (req): Promise<RestoreSkillVersionResult> => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.restore(
        workspaceId,
        req.params.id,
        req.params.version,
        req.body.expected_version,
      );
      if (!result) throw new NotFoundError('Skill not found');
      return { skill: toDto(result.skill), restored: result.restored };
    },
  );

  // `window` outside the enum is a 422 validation_error (zod on the route,
  // like every other input); a missing one defaults to 30d.
  app.get(
    '/skills/:id/stats',
    { schema: { params: IdParams, querystring: SkillStatsQuery } },
    async (req): Promise<SkillStatsDto> => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await statsService.stats(workspaceId, req.params.id, req.query.window);
      if (!stats) throw new NotFoundError('Skill not found');
      return toStatsDto(stats);
    },
  );
}
