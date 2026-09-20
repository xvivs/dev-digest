# specs/ — repo-wide

Plans for work that is **not built yet** and touches more than one package —
which is most of the lesson features (L03–L08 span server and client).

A spec lands before the code and describes what will be built and why. Once the
work ships, either delete it or promote the durable parts to `docs/`.

Work confined to a single package goes in `<package>/specs/` instead, so it loads
by location when an agent works in that package.

Not here: decisions already made (`docs/adr/`), how something currently works
(`docs/`, `README.md`), or debugging findings (`INSIGHTS.md`).
