# Zod in the Onion (server)

Where a zod schema is allowed to run and where only its inferred TS type may
appear. Placement, not zod mechanics — for `.safeParse`/`.parse`, `z.infer`,
refinements, read the `zod` skill.

## Shared kernel rule

`@devdigest/shared` is the one contract layer for HTTP validation, response
serialization and the client's types (ADR 0001). Every ring may `import type`
from it — e.g. `agents/service.ts:2-9` imports `Agent`, `AgentVersion`,
`Provider`, etc. as types only, no zod at runtime. **Running** a schema
(`z.object(...)`, `.parse`) is allowed in exactly two places:

- `routes.ts` — request/response contracts, via `fastify-type-provider-zod`.
  `agents/routes.ts:4,11,36` imports `Provider`/`CiFailOn`/`ReviewStrategy` as
  *values* (they are `z.enum(...)` in `vendor/shared/contracts/knowledge.ts:157,164,173`)
  and uses them inside `z.object({ ... })` route schemas.
- Infrastructure/mapper code parsing untyped `jsonb` read from the DB back into
  a typed shape. `agents/helpers.ts:36` — `toAgentVersionDto` —
  `config: AgentVersionConfig.parse(row.configJson)`: a stored snapshot could
  drift from the current config shape, so a malformed row throws here instead
  of leaking an unvalidated blob to the client.

`domain.ts`/`service.ts` never import `zod` at runtime — neither template file
does. For domain files (`domain.ts`, `constants.ts`, `types.ts`) the gate
enforces it: `domain-no-runtime-zod` fails on `import { z } from 'zod'` and lets
`import type` through. Two gaps stay **review-only**:
- `service.ts` importing `zod` (no rule; a service should not need it).
- A runtime *schema value* pulled from `@devdigest/shared`
  (`import { Provider } from '@devdigest/shared'` then `Provider.parse(…)`).
  `src/vendor/` is excluded from the graph, so the gate cannot see that edge.

## Contract vs invariant

A route's zod schema validates **shape** — types, required fields, field
presence. A **business rule** — depends on other rows, normalization, domain
state — is a pure function in `domain.ts`, never a `.refine()` on the contract.

**Good** — shape-only refine, the only `.refine()` in the codebase
(`agents/routes.ts:60-68`):

```ts
const SetSkillsBody = z.object({ skill_ids: z.array(z.string().uuid()).optional(), skill_id: z.string().uuid().optional() })
  .refine((b) => b.skill_ids !== undefined || b.skill_id !== undefined, { message: 'Provide skill_ids or skill_id' });
```

**Bad** — a business invariant (uniqueness) hidden in `.refine()` instead of
`domain.ts` (contrast with `templates/module/domain.ts:27-33`, which does this
normalization as a plain function service calls before persisting):

```ts
const CreateExampleBody = z.object({ name: z.string() })
  .refine(async (b) => !(await store.findByName(ws, b.name)), 'Name taken'); // reaches into the DB from a contract
```

([source](https://dev.to/yatindavra/my-zod-schema-was-valid-the-library-said-it-wasnt-2a92))

## Why not zod in the domain

Two concrete costs, not just principle:

1. **Duplicate zod instances.** `server/src/app.ts:135-142` already detects a
   `ZodError` *structurally* (`name === 'ZodError'` + `issues`/`errors` array)
   because `instanceof z.ZodError` can fail across the server's and
   `@devdigest/shared`'s separate zod instances. Zod reaching deeper into the
   domain means more call sites can hit this
   ([source](https://dev.to/yatindavra/my-zod-schema-was-valid-the-library-said-it-wasnt-2a92)).
2. **Vendored twice, no sync script.** `@devdigest/shared` is copied into
   `server/src/vendor/shared/` and `client/src/vendor/shared/` independently
   (`docs/adr/0001-vendored-shared.md`) — a domain-level zod dependency doubles
   the surface that can drift between the two copies.

The domain works with the inferred TS type (`z.infer<...>`, or `import type`),
never the schema object itself.

## Where DTO mapping happens

`routes.ts` maps the domain object to the public DTO — snake_case, ISO dates —
right before sending it; the domain never knows the HTTP shape
(`templates/module/routes.ts:21-24`):

```ts
function toDto(e: Example) {
  return { id: e.id, name: e.name, created_at: e.createdAt.toISOString() };
}
```

If the client consumes that DTO's type, it doesn't stay local to the route —
it becomes a contract, so it goes into `@devdigest/shared` in **both** vendored
copies (`server/src/vendor/shared/`, `client/src/vendor/shared/`), never only
the server's (`server/AGENTS.md` — Do not touch: "vendored copy... change both together").
([source](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/))
