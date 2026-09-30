CREATE TABLE "pr_blast_cache" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"head_sha" text NOT NULL,
	"source_sha" text NOT NULL,
	"indexer_version" integer NOT NULL,
	"index_status" text NOT NULL,
	"repo_intel_enabled" boolean NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"blast" jsonb NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_history_cache" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"head_sha" text NOT NULL,
	"base" text NOT NULL,
	"paths_hash" text NOT NULL,
	"history" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_risks" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"head_sha" text NOT NULL,
	"risks" jsonb NOT NULL,
	"dropped_refs" integer DEFAULT 0 NOT NULL,
	"rule_only" boolean DEFAULT false NOT NULL,
	"provider" text,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"cost_source" text,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "unresolved_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_blast_cache" ADD CONSTRAINT "pr_blast_cache_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_history_cache" ADD CONSTRAINT "pr_history_cache_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_risks" ADD CONSTRAINT "pr_risks_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;