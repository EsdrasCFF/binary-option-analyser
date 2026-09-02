ALTER TABLE "bankroll_ledger_entries" ALTER COLUMN "pattern_result_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bankroll_ledgers" ALTER COLUMN "analysis_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bankroll_ledger_entries" ADD COLUMN "multi_period_pattern_result_id" uuid;--> statement-breakpoint
ALTER TABLE "bankroll_ledgers" ADD COLUMN "multi_period_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "bankroll_ledger_entries" ADD CONSTRAINT "bankroll_ledger_entries_multi_period_pattern_result_id_multi_period_pattern_results_id_fk" FOREIGN KEY ("multi_period_pattern_result_id") REFERENCES "public"."multi_period_pattern_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bankroll_ledgers" ADD CONSTRAINT "bankroll_ledgers_multi_period_analysis_id_multi_period_analyses_id_fk" FOREIGN KEY ("multi_period_analysis_id") REFERENCES "public"."multi_period_analyses"("id") ON DELETE cascade ON UPDATE no action;