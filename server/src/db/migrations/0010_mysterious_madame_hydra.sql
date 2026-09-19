ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cost_source" text;--> statement-breakpoint
CREATE INDEX "agent_runs_pr_ran_at_idx" ON "agent_runs" USING btree ("pr_id","ran_at" DESC NULLS LAST);