/**
 * PRESENTATION — the HTTP driving adapter, and the only file Fastify sees.
 * parse (zod on the route) → service → map to the DTO. No Drizzle, no
 * `db/**`, no repository, no business branching, no `throw new AppError`
 * except `NotFoundError` for a missing resource the service reported.
 *
 * Register it in `src/modules/index.ts` (one import + one entry).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Example } from './domain.js';
import { buildExampleService } from './wiring.js';

/** HTTP contract. Shape only — business rules live in domain.ts. */
const CreateExampleBody = z.object({ name: z.string().min(1) });

/** Public DTO (snake_case, ISO dates). Move to @devdigest/shared if the client needs the type. */
function toDto(e: Example) {
  return { id: e.id, name: e.name, created_at: e.createdAt.toISOString() };
}

export default async function exampleRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = buildExampleService(app.container);

  app.get('/examples', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return (await service.list(workspaceId)).map(toDto);
  });

  app.post('/examples', { schema: { body: CreateExampleBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await service.create(workspaceId, req.body.name);
    return reply.status(201).send(toDto(created));
  });

  app.delete('/examples/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    if (!(await service.delete(workspaceId, req.params.id))) {
      throw new NotFoundError('Example not found');
    }
    return reply.status(204).send();
  });
}
