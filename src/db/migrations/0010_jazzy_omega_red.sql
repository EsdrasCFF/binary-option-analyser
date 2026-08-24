CREATE TABLE "bankroll_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"pattern_result_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"payout_pct" numeric(5, 2) NOT NULL,
	"entry_value" numeric(18, 2) NOT NULL,
	"result" varchar(10) NOT NULL,
	"profit_loss" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bankroll_ledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"name" varchar(60),
	"pattern_result_ids" jsonb NOT NULL,
	"initial_bankroll" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bankroll_ledger_entries" ADD CONSTRAINT "bankroll_ledger_entries_ledger_id_bankroll_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."bankroll_ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bankroll_ledger_entries" ADD CONSTRAINT "bankroll_ledger_entries_pattern_result_id_pattern_results_id_fk" FOREIGN KEY ("pattern_result_id") REFERENCES "public"."pattern_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bankroll_ledgers" ADD CONSTRAINT "bankroll_ledgers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bankroll_ledgers" ADD CONSTRAINT "bankroll_ledgers_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bankroll_ledger_entries_ledger_idx" ON "bankroll_ledger_entries" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "bankroll_ledgers_user_idx" ON "bankroll_ledgers" USING btree ("user_id");