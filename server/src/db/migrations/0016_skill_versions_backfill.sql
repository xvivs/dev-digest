-- ADR 0016 backfill. Before this change a skill's current name/description/type
-- belonged to its current version too (only a body edit bumped the version), so
-- the snapshot at skills.version can take them from the skill row. Older
-- snapshots keep NULL metadata: that state was never stored.
UPDATE "skill_versions" AS sv
SET "name" = s."name", "description" = s."description", "type" = s."type"
FROM "skills" AS s
WHERE sv."skill_id" = s."id" AND sv."version" = s."version" AND sv."name" IS NULL;
--> statement-breakpoint
-- Every skill gets a snapshot of its current version (v1 was never written on
-- insert, so an unedited skill had no history row at all). Earlier bodies are
-- lost for good; the UI shows those gaps as "vN body unavailable".
INSERT INTO "skill_versions" ("skill_id", "version", "body", "name", "description", "type", "created_at")
SELECT s."id", s."version", s."body", s."name", s."description", s."type", s."updated_at"
FROM "skills" AS s
ON CONFLICT ("skill_id", "version") DO NOTHING;
