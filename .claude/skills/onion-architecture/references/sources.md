# Sources

Every rule in this skill traces back to one of these. The research agents
opened every URL on 2026-09-28. This file is the bibliography for the skill's README.

## Onion / Hexagonal / Clean

- [Jeffrey Palermo — The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/): the original; layers, the dependency rule, "not appropriate for small websites"
- [Jeffrey Palermo — part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/): worked example; where interfaces live
- [Jeffrey Palermo — part 4, after four years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/): the four tenets, retrospective
- [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/): ports & adapters, driving vs driven
- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html): the Dependency Rule, simple data across boundaries
- [Herberto Graça — DDD, Hexagonal, Onion, Clean, CQRS… how I put it all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/): synthesis of all of the above
- [Microsoft — Common web application architectures](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures): Clean/Onion in a reference architecture
- [Gary Bernhardt — Boundaries](https://www.destroyallsoftware.com/talks/boundaries): functional core, imperative shell

## TypeScript / Node

- [Khalil Stemmler — Organizing app logic](https://khalilstemmler.com/articles/software-design-architecture/organizing-app-logic/): layers in a Node app
- [Khalil Stemmler — Application layer: use cases](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/): use case per scenario, CQS
- [Khalil Stemmler — Coding without a DI container](https://khalilstemmler.com/articles/software-design-architecture/coding-without-di-container/): composition root without a library
- [Khalil Stemmler — Repository, DTO, Mapper](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/): mapping at the boundaries
- [Sairyss — domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon): full TS reference plus its overengineering warnings
- [jbuget — nodejs-clean-architecture-app](https://github.com/jbuget/nodejs-clean-architecture-app): Clean Architecture on Node
- [tacoda — Hexagonal architecture in practice](https://dev.to/tacoda/hexagonal-architecture-in-practice-ports-adapters-and-tests-that-skip-the-database-5b19): ports and tests that skip the database

## Patterns (Fowler, Seemann, CodeOpinion)

- [Martin Fowler — Repository](https://martinfowler.com/eaaCatalog/repository.html)
- [Martin Fowler — Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- [Martin Fowler — Anemic Domain Model](https://martinfowler.com/bliki/AnemicDomainModel.html)
- [Martin Fowler — Presentation Domain Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html): layers vs vertical slices
- [Mark Seemann — Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)
- [CodeOpinion — Repository pattern with CQRS: yes and no](https://codeopinion.com/should-you-use-the-repository-pattern-with-cqrs-yes-and-no/): when reads bypass the domain

## Fastify / zod / DI

- [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)
- [Fastify — Plugins guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)
- [Fastify — Decorators](https://fastify.dev/docs/latest/Reference/Decorators/)
- [Fastify — Errors](https://fastify.dev/docs/latest/Reference/Errors/)
- [Fastify — Type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)
- [Fastify — Testing](https://fastify.dev/docs/latest/Guides/Testing/)
- [fastify-type-provider-zod README](https://github.com/turkerdev/fastify-type-provider-zod/blob/main/README.md)
- [fastify-awilix README](https://github.com/fastify/fastify-awilix/blob/main/README.md): considered and rejected
- [awilix README](https://github.com/jeffijoe/awilix/blob/master/README.md): lifetimes, scoped DI
- [GitNation — Building a modular monolith with Fastify](https://gitnation.com/contents/building-a-modular-monolith-with-fastify)
- [My zod schema was valid, the library said it wasn't](https://dev.to/yatindavra/my-zod-schema-was-valid-the-library-said-it-wasnt-2a92): duplicate zod instances

## Drizzle / Postgres / testing

- [Drizzle — Transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle — Goodies (`$inferSelect` / `$inferInsert`)](https://orm.drizzle.team/docs/goodies)
- [Drizzle — Vector similarity search](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- [drizzle-orm discussion #2777 — AsyncLocalStorage transactions](https://github.com/drizzle-team/drizzle-orm/discussions/2777)
- [drizzle-orm issue #543](https://github.com/drizzle-team/drizzle-orm/issues/543)
- [drizzle-orm issue #5792 — `drizzle-kit push` drops operator class](https://github.com/drizzle-team/drizzle-orm/issues/5792)
- [Sentry — Atomic repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript)
- [Docker — Testcontainers for Node.js](https://docs.docker.com/guides/testcontainers-nodejs-getting-started/)
- [The testing pyramid for hexagonal](https://dev.to/gabrielanhaia/the-testing-pyramid-for-hexagonal-php-unit-the-core-contract-the-ports-5e76): PHP, but the pyramid carries over

## Enforcement

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md): `forbidden`, `$1` group matching
- [dependency-cruiser — rules tutorial](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-tutorial.md)
- [dependency-cruiser — CLI](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md): output types, baseline, `--ignore-known`
- [eslint-plugin-boundaries](https://www.npmjs.com/package/eslint-plugin-boundaries) and its [element-types rule](https://github.com/javierbrea/eslint-plugin-boundaries/blob/master/docs/rules/element-types.md): considered, needs ESLint bootstrap
- [ESLint — no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports): considered, no group matching
- [eslint-plugin-import — no-restricted-paths](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md): considered
- [TypeScript — Project references](https://www.typescriptlang.org/docs/handbook/project-references.html): considered, needs a split tsconfig
- [Nx — Enforce module boundaries](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries): needs a workspace
- [ts-arch](https://github.com/ts-arch/ts-arch), [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) ([docs](https://lukasniessen.github.io/ArchUnitTS/)): fallback, architecture tests in vitest
