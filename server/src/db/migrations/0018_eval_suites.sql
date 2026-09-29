CREATE TABLE "eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version" integer NOT NULL,
	"prompt_sha256" text NOT NULL,
	"carrier_agent_id" uuid NOT NULL,
	"carrier_agent_version" integer NOT NULL,
	"carrier_agent_name" text NOT NULL,
	"model" text NOT NULL,
	"run_config" jsonb NOT NULL,
	"mode" text NOT NULL,
	"repeats" integer NOT NULL,
	"status" text DEFAULT 'estimated' NOT NULL,
	"total_jobs" integer NOT NULL,
	"done_jobs" integer DEFAULT 0 NOT NULL,
	"estimate_usd" double precision NOT NULL,
	"cost_usd" double precision,
	"cost_source" text,
	"results" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "eval_suites_mode_check" CHECK ("eval_suites"."mode" IN ('quick', 'full')),
	CONSTRAINT "eval_suites_status_check" CHECK ("eval_suites"."status" IN ('estimated', 'running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "eval_suites_cost_source_check" CHECK ("eval_suites"."cost_source" IS NULL OR "eval_suites"."cost_source" IN ('provider', 'estimated')),
	CONSTRAINT "eval_suites_cost_pair_check" CHECK (("eval_suites"."cost_usd" IS NULL) = ("eval_suites"."cost_source" IS NULL)),
	CONSTRAINT "eval_suites_jobs_check" CHECK ("eval_suites"."done_jobs" >= 0 AND "eval_suites"."total_jobs" >= 0 AND "eval_suites"."repeats" > 0)
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "suite_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "arm" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "repeat_idx" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "matched" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "expected" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "unexpected" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_suites_skill_created_idx" ON "eval_suites" USING btree ("skill_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "eval_suites_one_running_per_workspace_uq" ON "eval_suites" USING btree ("workspace_id") WHERE "eval_suites"."status" = 'running';--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_suite_case_arm_repeat_uq" ON "eval_runs" USING btree ("suite_id","case_id","arm","repeat_idx");--> statement-breakpoint
CREATE INDEX "eval_runs_suite_status_idx" ON "eval_runs" USING btree ("suite_id","status");--> statement-breakpoint
CREATE INDEX "eval_runs_case_id_idx" ON "eval_runs" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_arm_check" CHECK ("eval_runs"."arm" IS NULL OR "eval_runs"."arm" IN ('with', 'without'));--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_status_check" CHECK ("eval_runs"."status" IS NULL OR "eval_runs"."status" IN ('queued', 'running', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_cost_source_check" CHECK ("eval_runs"."cost_source" IS NULL OR "eval_runs"."cost_source" IN ('provider', 'estimated'));