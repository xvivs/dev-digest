/**
 * Architecture gate for server/src — Onion layering of feature modules.
 * Rationale and the layer map: docs/adr/0005-onion-layering-for-server-modules.md
 * and the `onion-architecture` skill (.claude/skills/onion-architecture/).
 *
 * Layer = file role inside src/modules/<name>/:
 *   domain          domain.ts · constants.ts · types.ts
 *   mapper          helpers.ts            (pure; may import row TYPES only)
 *   ports           ports.ts
 *   application     service.ts
 *   infrastructure  repository.ts · repository/** · repo-intel/pipeline/**
 *   presentation    routes.ts
 *   composition     wiring.ts             (module composition root: builds service + repo)
 *
 * Existing violations are frozen in .dependency-cruiser-known-violations.json
 * (`pnpm arch:baseline`). `pnpm arch:check` fails only on NEW ones.
 *
 * NOT the same as src/adapters/depgraph — that adapter calls dependency-cruiser
 * at runtime on *target* repos and never reads this file.
 */

const MOD = '^src/modules/[^/]+/';
const DOMAIN = `${MOD}(domain|constants|types)\\.ts$`;
const MAPPER = `${MOD}helpers\\.ts$`;
const APPLICATION = `${MOD}service\\.ts$`;
const INFRA = `${MOD}(repository\\.ts$|repository/|pipeline/)`;
const PRESENTATION = `${MOD}routes\\.ts$`;
const WIRING = `${MOD}wiring\\.ts$`;

const DB = ['^src/db/', '(^|/)node_modules/drizzle-orm/', '(^|/)node_modules/postgres/'];
const FASTIFY = ['(^|/)node_modules/fastify/', '(^|/)node_modules/fastify-type-provider-zod/'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'modules-no-cross-import',
      comment:
        'A module never imports another module. Shared entities hang off the container ' +
        '(container.agentsRepo, container.reviewRepo, container.repoIntel) or live in _shared/.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
      },
    },
    {
      name: 'presentation-no-db',
      comment: 'routes.ts is a thin driving adapter: parse → service → DTO. No Drizzle, no db/**.',
      severity: 'error',
      from: { path: PRESENTATION },
      to: { path: DB },
    },
    {
      name: 'application-no-db',
      comment: 'service.ts holds no SQL. Persistence goes through the repository (or a port).',
      severity: 'error',
      from: { path: APPLICATION },
      to: { path: DB, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'application-no-fastify',
      comment: 'service.ts must run without Fastify — HTTP stays in routes.ts.',
      severity: 'error',
      from: { path: [APPLICATION, DOMAIN, MAPPER, INFRA] },
      to: { path: FASTIFY },
    },
    {
      name: 'application-no-presentation',
      comment: 'Dependencies point inward: service.ts never imports routes.ts.',
      severity: 'error',
      from: { path: APPLICATION },
      to: { path: PRESENTATION },
    },
    {
      name: 'application-no-infra',
      comment:
        'service.ts depends on a port (ports.ts), never on the concrete repository. ' +
        'wiring.ts plugs the Drizzle implementation in. Type-only imports are tolerated.',
      severity: 'error',
      from: { path: APPLICATION },
      to: { path: INFRA, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'presentation-no-infra',
      comment: 'routes.ts gets its service from wiring.ts; it never touches a repository.',
      severity: 'error',
      from: { path: PRESENTATION },
      to: { path: INFRA },
    },
    {
      name: 'infrastructure-no-upward',
      comment: 'A repository implements a port; it never reaches up into service.ts or routes.ts.',
      severity: 'error',
      from: { path: INFRA },
      to: { path: [APPLICATION, PRESENTATION, WIRING] },
    },
    {
      name: 'domain-is-pure',
      comment:
        'domain.ts / constants.ts / types.ts: no I/O, no container, no db, no adapters, ' +
        'no outer layers of the module.',
      severity: 'error',
      from: { path: DOMAIN },
      to: {
        path: [
          ...DB,
          '^src/platform/container\\.ts$',
          '^src/adapters/',
          APPLICATION,
          INFRA,
          PRESENTATION,
          WIRING,
        ],
      },
    },
    {
      name: 'domain-no-runtime-zod',
      comment:
        'Invariants are plain functions in domain.ts, not zod schemas. `import type` is fine. ' +
        'Runtime schema values from @devdigest/shared are not visible here (src/vendor is excluded) — review-only.',
      severity: 'error',
      from: { path: DOMAIN },
      to: { path: '(^|/)node_modules/zod/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'mapper-is-pure',
      comment:
        'helpers.ts maps rows ⇄ DTOs: row TYPES are fine, runtime db/drizzle/container/adapters are not.',
      severity: 'error',
      from: { path: MAPPER },
      to: {
        path: [...DB, '^src/platform/container\\.ts$', '^src/adapters/', APPLICATION, PRESENTATION],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'only-container-constructs-adapters',
      comment:
        'Feature modules resolve adapters from the container. repo-intel is the facade that owns ' +
        'the indexer adapters (see src/modules/repo-intel/AGENTS.md).',
      severity: 'error',
      from: { path: '^src/modules/', pathNot: '^src/modules/repo-intel/' },
      to: { path: '^src/adapters/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'repo-intel-libs-behind-facade',
      comment: 'Indexer libraries are reached only through container.repoIntel.',
      severity: 'error',
      from: { path: '^src/modules/', pathNot: '^src/modules/repo-intel/' },
      to: {
        path: [
          '(^|/)node_modules/@ast-grep/',
          '(^|/)node_modules/dependency-cruiser/',
          '(^|/)node_modules/graphology',
          '(^|/)node_modules/js-tiktoken/',
        ],
      },
    },
    {
      name: 'adapters-no-modules',
      comment: 'Adapters are the outermost ring: they never import a feature module.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      comment: 'Runtime cycles make the dependency direction meaningless.',
      severity: 'error',
      from: { path: '^src/' },
      // Type-only edges (`import type { Container }`) vanish at runtime — only
      // a cycle made entirely of value imports is a real one.
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^src/vendor/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
