ALTER TABLE "skill_versions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "change_note" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_type_check" CHECK ("skill_versions"."type" IS NULL OR "skill_versions"."type" IN ('rubric', 'convention', 'security', 'custom'));