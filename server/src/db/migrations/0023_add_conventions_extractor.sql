CREATE TABLE "convention_observations" (
	"scan_id" uuid NOT NULL,
	"convention_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"support_count" integer DEFAULT 0 NOT NULL,
	"counter_count" integer DEFAULT 0 NOT NULL,
	"review_hits" integer DEFAULT 0 NOT NULL,
	"llm_confidence" double precision,
	"confidence" double precision NOT NULL,
	"relocated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "convention_observations_scan_id_convention_id_pk" PRIMARY KEY("scan_id","convention_id"),
	CONSTRAINT "convention_observations_evidence_array_check" CHECK (jsonb_typeof("convention_observations"."evidence") = 'array')
);
--> statement-breakpoint
CREATE TABLE "convention_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"status" text NOT NULL,
	"job_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"commit_sha" text,
	"sample_file_count" integer DEFAULT 0 NOT NULL,
	"found_count" integer DEFAULT 0 NOT NULL,
	"verified_count" integer DEFAULT 0 NOT NULL,
	"dropped_count" integer DEFAULT 0 NOT NULL,
	"relocated_count" integer DEFAULT 0 NOT NULL,
	"matched_prior_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"cost_source" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "convention_scans_status_check" CHECK ("convention_scans"."status" IN ('running', 'done', 'failed')),
	CONSTRAINT "convention_scans_cost_source_check" CHECK ("convention_scans"."cost_source" IS NULL OR "convention_scans"."cost_source" IN ('provider', 'estimated'))
);
--> statement-breakpoint
CREATE TABLE "convention_skills" (
	"convention_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "convention_skills_convention_id_skill_id_pk" PRIMARY KEY("convention_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "origin" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "original_rule" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "last_seen_scan_id" uuid;--> statement-breakpoint
ALTER TABLE "convention_observations" ADD CONSTRAINT "convention_observations_scan_id_convention_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."convention_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_observations" ADD CONSTRAINT "convention_observations_convention_id_conventions_id_fk" FOREIGN KEY ("convention_id") REFERENCES "public"."conventions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_skills" ADD CONSTRAINT "convention_skills_convention_id_conventions_id_fk" FOREIGN KEY ("convention_id") REFERENCES "public"."conventions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_skills" ADD CONSTRAINT "convention_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convention_observations_convention_idx" ON "convention_observations" USING btree ("convention_id");--> statement-breakpoint
CREATE INDEX "convention_scans_ws_idx" ON "convention_scans" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "convention_scans_repo_started_idx" ON "convention_scans" USING btree ("repo_id","started_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "convention_scans_repo_running_uq" ON "convention_scans" USING btree ("repo_id") WHERE "convention_scans"."status" = 'running';--> statement-breakpoint
CREATE INDEX "convention_skills_skill_idx" ON "convention_skills" USING btree ("skill_id");--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_last_seen_scan_id_convention_scans_id_fk" FOREIGN KEY ("last_seen_scan_id") REFERENCES "public"."convention_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conventions_repo_fingerprint_uq" ON "conventions" USING btree ("repo_id","fingerprint");--> statement-breakpoint
CREATE INDEX "conventions_ws_idx" ON "conventions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conventions_last_seen_scan_idx" ON "conventions" USING btree ("last_seen_scan_id");--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_category_check" CHECK ("conventions"."category" IN ('naming', 'structure', 'error-handling', 'async', 'typing', 'testing', 'imports', 'api', 'other'));--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_origin_check" CHECK ("conventions"."origin" IN ('code', 'review_history'));--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_status_check" CHECK ("conventions"."status" IN ('pending', 'accepted', 'rejected'));