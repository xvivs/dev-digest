CREATE INDEX "pr_commits_pr_idx" ON "pr_commits" USING btree ("pr_id");--> statement-breakpoint
ALTER TABLE "pr_blast_cache" ADD CONSTRAINT "pr_blast_cache_status_check" CHECK ("pr_blast_cache"."status" IN ('ok', 'degraded'));--> statement-breakpoint
ALTER TABLE "pr_blast_cache" ADD CONSTRAINT "pr_blast_cache_reason_check" CHECK ("pr_blast_cache"."reason" IS NULL OR "pr_blast_cache"."reason" IN ('index_partial', 'no_index', 'flag_off', 'no_changed_files'));--> statement-breakpoint
ALTER TABLE "pr_blast_cache" ADD CONSTRAINT "pr_blast_cache_index_status_check" CHECK ("pr_blast_cache"."index_status" IN ('full', 'partial', 'degraded', 'failed'));--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_cost_source_check" CHECK ("pr_intent"."cost_source" IS NULL OR "pr_intent"."cost_source" IN ('provider', 'estimated'));--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_confidence_check" CHECK ("pr_intent"."confidence" IN ('high', 'medium', 'low'));--> statement-breakpoint
ALTER TABLE "pr_risks" ADD CONSTRAINT "pr_risks_cost_source_check" CHECK ("pr_risks"."cost_source" IS NULL OR "pr_risks"."cost_source" IN ('provider', 'estimated'));