-- Plan Phase 3 [R9][F-R9] backfill, before 0020 adds the FK + CHECK.
-- A skill-owned case whose owner no longer exists in the SAME workspace is an
-- orphan (owner_id was never a real FK). It can never be run or shown, and it
-- would block the FK, so it is deleted; its eval_runs cascade.
DELETE FROM "eval_cases" AS ec
WHERE ec."owner_kind" = 'skill'
  AND NOT EXISTS (
    SELECT 1 FROM "skills" AS s
    WHERE s."id" = ec."owner_id" AND s."workspace_id" = ec."workspace_id"
  );
--> statement-breakpoint
-- Every remaining skill case points skill_id at its owner. Idempotent: rows
-- already set are skipped.
UPDATE "eval_cases"
SET "skill_id" = "owner_id"
WHERE "owner_kind" = 'skill' AND "skill_id" IS NULL;
--> statement-breakpoint
-- ADR 0002: cost_usd and cost_source are null together. Legacy L06 runs wrote
-- a cost with no provenance; the weakest claim, 'estimated', is the honest
-- label for a number of unknown origin.
UPDATE "eval_runs"
SET "cost_source" = 'estimated'
WHERE "cost_usd" IS NOT NULL AND "cost_source" IS NULL;
