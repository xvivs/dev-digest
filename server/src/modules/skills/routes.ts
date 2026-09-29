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
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, type Skill as SkillDto } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Skill } from './domain.js';
import { SkillBody, SkillDescription, SkillName } from '../_shared/skill-rules.js';
import { buildSkillsService } from './wiring.js';

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
 *  creatable), all optional. `source` is omitted BEFORE `.partial()` so its
 *  `.default('manual')` never leaks into an update. */
const UpdateSkillBody = CreateSkillBody.omit({ source: true })
  .partial()
  .extend({ enabled: z.boolean().optional() })
  .strict();

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

function toListDto(s: Skill & { agentCount: number }): SkillDto & { agent_count: number } {
  return { ...toDto(s), agent_count: s.agentCount };
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = buildSkillsService(app.container);

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
      const skill = await service.update(workspaceId, req.params.id, req.body);
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
}
