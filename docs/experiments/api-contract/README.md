# API Contract control experiment

Skills, rubric and result tables for the SPEC-02 rerun in `specs/02-conventions.md`.

- `skills/` holds three rubric skills: `response-schema`, `semver-discipline`, `deprecation-policy`.
- `protocol.md` is the rubric, written before any run, plus the four breakages to seed in `demo/api-breaking-change`.
- `results.md` is the empty results template. It gets filled from measured runs only.

To reproduce:

1. Import `fixtures/skills/api-breaking-change` through the Import drawer. It arrives disabled and unvetted, so open Review and trust and vet it before condition B.
2. Add the three files in `skills/` as skills, link all four to API Contract Reviewer.
3. Create the demo branch from the catalogue in `protocol.md`, then follow its conditions and control check. Never merge the branch.
