# server/docs/

Server architecture that needs more than a `CLAUDE.md` line and is true only of
`@devdigest/api`. Long-lived: how the engine is built, not how to use it.

Point at a file here from `server/CLAUDE.md` with a `Read X when Y` line.

- `request-lifecycle.md` — plugin order, validation, DI resolution, error handling.
- `db-schema-map.md` — which tables are live, which are lesson scaffolding.

Not here: usage and the API map (`../README.md`), plans for unbuilt work
(`../specs/`), debugging findings (`../INSIGHTS.md`), or cross-package decisions
(`../../docs/`).
