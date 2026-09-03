CREATE TYPE "public"."backtest_plus_entry_result" AS ENUM('win', 'loss', 'tie', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."backtest_plus_invalid_reason" AS ENUM('no_data', 'doji');--> statement-breakpoint
CREATE TYPE "public"."backtest_plus_model_type" AS ENUM('top_score', 'random', 'rotation', 'weighted_score', 'diversified');--> statement-breakpoint
CREATE TABLE "backtest_plus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_analysis_id" uuid NOT NULL,
	"name" varchar(60),
	"reference_date" timestamp with time zone NOT NULL,
	"entries_per_day" integer NOT NULL,
	"forward_days_requested" integer NOT NULL,
	"random_seed" integer NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"effective_start_date" timestamp with time zone,
	"effective_end_date" timestamp with time zone,
	"days_tested" integer,
	"best_model" "backtest_plus_model_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "backtest_plus_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"source_result_id" uuid NOT NULL,
	"pool_rank" integer NOT NULL,
	"currency_pair_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"direction" "direction" NOT NULL,
	"confidence_score" integer NOT NULL,
	"classification" "multi_period_classification" NOT NULL,
	"recommendation" "multi_period_recommendation" NOT NULL,
	"momentum_trend" "multi_period_momentum" NOT NULL,
	"structural_average" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_plus_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"target_date" timestamp with time zone NOT NULL,
	"entry_order" integer NOT NULL,
	"result" "backtest_plus_entry_result" NOT NULL,
	"invalid_reason" "backtest_plus_invalid_reason",
	"candle_open_time" timestamp with time zone,
	"candle_open" numeric(18, 8),
	"candle_high" numeric(18, 8),
	"candle_low" numeric(18, 8),
	"candle_close" numeric(18, 8),
	"actual_direction" "direction"
);
--> statement-breakpoint
CREATE TABLE "backtest_plus_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"model_type" "backtest_plus_model_type" NOT NULL,
	"rank_position" integer NOT NULL,
	"days_tested" integer NOT NULL,
	"successful_days" integer NOT NULL,
	"failed_days" integer NOT NULL,
	"daily_success_rate" numeric(6, 4) NOT NULL,
	"zero_of_n_rate" numeric(6, 4) NOT NULL,
	"total_entries" integer NOT NULL,
	"total_wins" integer NOT NULL,
	"total_losses" integer NOT NULL,
	"total_ties" integer NOT NULL,
	"invalid_entries" integer NOT NULL,
	"individual_hit_rate" numeric(6, 4) NOT NULL,
	"average_entries_until_first_win" numeric(6, 3),
	"median_entries_until_first_win" numeric(6, 3),
	"first_win_at_1" integer NOT NULL,
	"first_win_at_2" integer NOT NULL,
	"first_win_at_3" integer NOT NULL,
	"first_win_at_4" integer NOT NULL,
	"first_win_at_5" integer,
	"zero_of_n" integer NOT NULL,
	"coverage_at_1" numeric(6, 4) NOT NULL,
	"coverage_at_2" numeric(6, 4) NOT NULL,
	"coverage_at_3" numeric(6, 4) NOT NULL,
	"coverage_at_4" numeric(6, 4) NOT NULL,
	"coverage_at_5" numeric(6, 4)
);
--> statement-breakpoint
ALTER TABLE "backtest_plus" ADD CONSTRAINT "backtest_plus_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus" ADD CONSTRAINT "backtest_plus_source_analysis_id_multi_period_analyses_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "public"."multi_period_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus_candidates" ADD CONSTRAINT "backtest_plus_candidates_backtest_id_backtest_plus_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtest_plus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus_candidates" ADD CONSTRAINT "backtest_plus_candidates_source_result_id_multi_period_pattern_results_id_fk" FOREIGN KEY ("source_result_id") REFERENCES "public"."multi_period_pattern_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus_candidates" ADD CONSTRAINT "backtest_plus_candidates_currency_pair_id_currency_pairs_id_fk" FOREIGN KEY ("currency_pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus_entries" ADD CONSTRAINT "backtest_plus_entries_model_id_backtest_plus_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."backtest_plus_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus_entries" ADD CONSTRAINT "backtest_plus_entries_candidate_id_backtest_plus_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."backtest_plus_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_plus_models" ADD CONSTRAINT "backtest_plus_models_backtest_id_backtest_plus_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtest_plus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_plus_user_idx" ON "backtest_plus" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backtest_plus_source_analysis_idx" ON "backtest_plus" USING btree ("source_analysis_id");--> statement-breakpoint
CREATE INDEX "backtest_plus_candidates_backtest_idx" ON "backtest_plus_candidates" USING btree ("backtest_id");--> statement-breakpoint
CREATE INDEX "backtest_plus_entries_model_idx" ON "backtest_plus_entries" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "backtest_plus_entries_target_date_idx" ON "backtest_plus_entries" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "backtest_plus_models_backtest_idx" ON "backtest_plus_models" USING btree ("backtest_id");