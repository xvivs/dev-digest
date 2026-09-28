# Fastify in the Onion (server)

How Fastify plays the presentation ring: what a handler may touch, how a route
gets its service without seeing a repository, how errors cross the HTTP
boundary, what counts as a module boundary. Placement, not mechanics — for
hooks, schemas, plugin authoring, read `fastify-best-practices`.

## Routes are a driving adapter

`routes.ts` does three things per handler: parse (zod `schema.params`/`body`),
call one service method, map the result to a DTO. A handler may resolve
`getContext`, call `service.*`, build a DTO, and `throw new NotFoundError(...)`
for a resource the service reported missing — nothing else. No Drizzle query,
no business branching; `server/.dependency-cruiser.cjs` enforces both
(`presentation-no-db`, `presentation-no-infra`, :49-54, :86-91). The template
(`templates/module/routes.ts:30-39`) is the target shape:

```ts
app.post('/examples', { schema: { body: CreateExampleBody } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req);
  const created = await service.create(workspaceId, req.body.name);
  return reply.status(201).send(toDto(created));
});
```

**Bad** — the actual state of `src/modules/pulls/routes.ts` (398 lines, 18
occurrences of `container.db`), querying Drizzle straight from the handler
(`server/src/modules/pulls/routes.ts:31-37`):

```ts
app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const [repo] = await container.db.select().from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
  if (!repo) throw new NotFoundError('Repo not found');
```

`pulls`/`polling`/`settings`/`workspace` predate the layering, frozen in
`.dependency-cruiser-known-violations.json` — don't extend this into new code
(`server/AGENTS.md:104-107`).
([source](https://dev.to/tacoda/hexagonal-architecture-in-practice-ports-adapters-and-tests-that-skip-the-database-5b19))

## Composition: container → wiring.ts → routes

`routes.ts` never imports `repository.ts` — it imports `wiring.ts`, which is
the only module file allowed to see both the service and the concrete
repository (`templates/module/wiring.ts:10-12`, `templates/module/routes.ts:16,28`):

```ts
export function buildExampleService(container: Container): ExampleService {
  return new ExampleService(new ExampleRepository(container.db));
}
```

`service = buildExampleService(app.container)` is the whole composition step in
the route — this is why `service.ts` takes a port (`ExampleStore`) instead of a
`Container`: the port is satisfied by the real repository in production and an
in-memory fake in tests, and `wiring.ts` is the seam that picks which one
(`server/AGENTS.md:13`). A plain Composition Root, not a container feature
([source](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)).

**Not yet migrated:** `agents/service.ts` builds its own repository in the
constructor (`this.repo = new AgentsRepository(container.db)`,
`server/src/modules/agents/service.ts:11,52,54-55`), and `agents/routes.ts:72`
constructs the service directly (`new AgentsService(app.container)`) — no
`wiring.ts`. Exactly the frozen `application-no-infra` violation in
`.dependency-cruiser-known-violations.json`. Baseline, not a pattern to copy.

The app's `Container` is itself a composition root: adapters are lazy getters
constructed on first access and cached, e.g. `agentsRepo ??= new
AgentsRepository(this.db)` (`server/src/platform/container.ts:89-93,95-101`).
Per-request tenancy resolves once, through `getContext(container, req)`
(`server/src/modules/_shared/context.ts:14-23`) — every route calls it before
touching the service, never re-derived inside one.

## Errors cross the boundary one way

Domain and application code throw — they never touch Fastify. Domain errors
subclass `AppError` (`server/src/platform/errors.ts:7-17`); the generic ones
(`NotFoundError`, `ValidationError`, `ExternalServiceError`, `ConfigError`,
:19-41) live in `platform/errors.ts`, module-specific ones (e.g.
`ExampleNameTakenError`) in the module's `domain.ts` (`templates/module/domain.ts:35-45`).
Only `app.ts`'s `setErrorHandler`, registered **before** the modules so
encapsulated plugins inherit it (`server/src/app.ts:114-115,166-170`), decides
the HTTP status. The one error a route may throw itself is `NotFoundError`, to
translate a service's `undefined`/`false` into a 404 (`templates/module/routes.ts:41-47`,
`agents/routes.ts:79-83`):

```ts
// setErrorHandler (app.ts) — the only place a domain error becomes a status code
if (err instanceof AppError) reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });

// routes.ts — the one AppError a route may raise itself
const agent = await service.get(workspaceId, req.params.id);
if (!agent) throw new NotFoundError('Agent not found');
```

`setErrorHandler` also has two non-domain branches: zod request-validation
failures via `hasZodFastifySchemaValidationErrors` → 422, and a **structural**
`ZodError` fallback (`name === 'ZodError'` + `issues`/`errors` array), because
`instanceof z.ZodError` can miss across the two vendored zod instances
(`server/src/app.ts:135-152`; see `references/zod.md`).
([source](https://fastify.dev/docs/latest/Reference/Errors/))

## Encapsulation = module boundary

Every `app.register(somePlugin)` opens a new encapsulation context: decorators
and hooks set inside don't leak to siblings or the parent
([source](https://fastify.dev/docs/latest/Reference/Encapsulation/)). Never
wrap a module's default export in `fastify-plugin` unless it must leak
decorators upward ([source](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)).
Child contexts don't inherit type info automatically, so each module calls
`appBase.withTypeProvider<ZodTypeProvider>()` again at its own top
(`templates/module/routes.ts:27`, `agents/routes.ts:71`;
[source](https://fastify.dev/docs/latest/Reference/Type-Providers/)). Security
plugins and the error handler register **before** the module loop
(`server/src/app.ts:87-170`; `server/AGENTS.md:51-52`), so every module
inherits them.

## Job handlers are driving adapters too

Long-running work goes through `container.jobs` (`JobRunner`), never inline in
a request — SKILL.md hard rule 12. A job handler is held to the same bar as a
route: thin, no business branching, delegates to the service immediately
(`server/src/modules/repos/service.ts:45-50`):

```ts
registerCloneJobHandler(): void {
  this.container.jobs.register(CLONE_JOB_KIND, (payload) => this.runCloneJob(payload as CloneJobPayload));
}
```

`server/AGENTS.md:53-54`: **"Handlers are registered by kind at wiring time"**
— `wiring.ts` builds the service and registers its job handler, the same seam
that builds it for a route. `repos` predates `wiring.ts`: registration is
triggered from `repos/routes.ts:24` (`service.registerCloneJobHandler()`)
instead. New modules with a job register from `wiring.ts`, not the route body
([source](https://dev.to/tacoda/hexagonal-architecture-in-practice-ports-adapters-and-tests-that-skip-the-database-5b19)).

## Testing the HTTP ring

`buildApp({ config, overrides })` builds a real Fastify instance without
binding a port; `app.inject()` drives it in-process
([source](https://fastify.dev/docs/latest/Guides/Testing/)). Use it for
contract/route tests only — status codes, error envelope, schema validation —
never business logic (`server/test/routes-smoke.test.ts:1-24`):

```ts
const app = await buildApp({ config, overrides: { github: new MockGitHubClient(...) } });
const res = await app.inject({ method: 'POST', url: '/settings/test-connection', payload: {...} });
```

Logic — invariants, branching, the transaction boundary — is tested against
`service.ts` directly with an in-memory fake of the port, no Fastify instance
and no Docker (`templates/module/service.test.ts:17-51`: `new
ExampleService(new InMemoryExampleStore()).create('ws', '  My   example ')`
→ `name` normalized to `'My example'`). Full pyramid: `references/testing.md`.

## DI container choice

| | Hand-written `Container` (current) | `awilix` (rejected) |
|---|---|---|
| Dependencies | 0 new | +2 packages (`awilix`, `@fastify/awilix`) |
| Per-request scoping | Manual — `getContext(container, req)` per handler | Built in — `diScope` + `Lifetime.SCOPED` in `onRequest` |
| Type safety | Full — explicit getters, compile-checked | Partial — resolved via `cradle`/string keys, typed by hand |

Kept: `container.ts`'s lazy getters + `ContainerOverrides` already give tests
full substitutability; the graph is mid-sized and stable, so awilix's
scoped-lifetime machinery has no current consumer
([source](https://github.com/jeffijoe/awilix/blob/master/README.md), [source](https://github.com/fastify/fastify-awilix/blob/main/README.md)).
