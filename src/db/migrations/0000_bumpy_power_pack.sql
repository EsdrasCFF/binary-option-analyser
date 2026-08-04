CREATE TYPE "public"."data_provider_type" AS ENUM('csv', 'api');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('CALL', 'PUT', 'DOJI');--> statement-breakpoint
CREATE TYPE "public"."doji_policy" AS ENUM('ignore', 'count_as_loss', 'count_as_tie');--> statement-breakpoint
CREATE TYPE "public"."entry_strategy" AS ENUM('same_direction', 'contrarian');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'completed', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pattern_status" AS ENUM('forte_e_ativo', 'ativo', 'perdendo_forca', 'inativo', 'amostra_insuficiente');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analysis_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"currency_pair_ids" jsonb NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"historical_days" integer,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"min_repetition_pct" numeric(5, 2) NOT NULL,
	"min_valid_days" integer NOT NULL,
	"weekdays" jsonb,
	"data_provider_id" uuid,
	"entry_strategy" "entry_strategy" DEFAULT 'same_direction' NOT NULL,
	"doji_tolerance_pct" numeric(6, 4) DEFAULT '0' NOT NULL,
	"doji_policy" "doji_policy" DEFAULT 'ignore' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100),
	"entity_id" uuid,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"operation_date" timestamp with time zone NOT NULL,
	"currency_pair_id" uuid NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"entry_direction" "direction" NOT NULL,
	"actual_direction" "direction" NOT NULL,
	"martingale_level_reached" integer DEFAULT 0 NOT NULL,
	"entry_value" numeric(18, 2) NOT NULL,
	"result" varchar(10) NOT NULL,
	"profit_loss" numeric(18, 2) NOT NULL,
	"bankroll_after" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pattern_result_ids" jsonb NOT NULL,
	"entry_strategy" "entry_strategy" NOT NULL,
	"payout_pct" numeric(5, 2) NOT NULL,
	"initial_bankroll" numeric(18, 2) NOT NULL,
	"initial_entry" numeric(18, 2) NOT NULL,
	"min_profit" numeric(18, 2) NOT NULL,
	"martingale_levels" integer DEFAULT 0 NOT NULL,
	"max_exposure_limit" numeric(18, 2),
	"daily_loss_limit" numeric(18, 2),
	"max_operations_per_day" integer,
	"doji_policy" "doji_policy" DEFAULT 'ignore' NOT NULL,
	"one_entry_per_time_slot" boolean DEFAULT true NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"final_bankroll" numeric(18, 2),
	"total_operations" integer,
	"max_drawdown" numeric(18, 2),
	"profit_factor" numeric(10, 4),
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bankroll_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"bankroll" numeric(18, 2) NOT NULL,
	"payout_pct" numeric(5, 2) NOT NULL,
	"max_exposure_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency_pair_id" uuid NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"open" numeric(18, 8) NOT NULL,
	"high" numeric(18, 8) NOT NULL,
	"low" numeric(18, 8) NOT NULL,
	"close" numeric(18, 8) NOT NULL,
	"volume" numeric(18, 8),
	"source" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"base_currency" varchar(10) NOT NULL,
	"quote_currency" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "data_provider_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"data_provider_id" uuid NOT NULL,
	"file_name" varchar(255),
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"total_rows" integer,
	"imported_rows" integer,
	"duplicate_rows" integer,
	"error_rows" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "martingale_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bankroll_configuration_id" uuid,
	"mode" varchar(20) NOT NULL,
	"bankroll" numeric(18, 2) NOT NULL,
	"payout_pct" numeric(5, 2) NOT NULL,
	"initial_entry" numeric(18, 2),
	"min_profit" numeric(18, 2) NOT NULL,
	"martingale_levels" integer NOT NULL,
	"max_exposure_pct" numeric(5, 2),
	"total_capital_required" numeric(18, 2) NOT NULL,
	"pct_bankroll_exposed" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "martingale_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calculation_id" uuid NOT NULL,
	"level_index" integer NOT NULL,
	"level_name" varchar(50) NOT NULL,
	"entry_value" numeric(18, 2) NOT NULL,
	"accumulated_losses_before" numeric(18, 2) NOT NULL,
	"gross_profit_if_win" numeric(18, 2) NOT NULL,
	"net_profit_after_recovery" numeric(18, 2) NOT NULL,
	"accumulated_exposure" numeric(18, 2) NOT NULL,
	"pct_of_bankroll_used" numeric(5, 2) NOT NULL,
	"remaining_balance_if_lost" numeric(18, 2) NOT NULL,
	"bankroll_supports_next_level" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"currency_pair_id" uuid NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"total_days_analyzed" integer NOT NULL,
	"total_valid" integer NOT NULL,
	"call_count" integer NOT NULL,
	"put_count" integer NOT NULL,
	"doji_count" integer NOT NULL,
	"predominant_direction" "direction",
	"repetition_pct" numeric(5, 2) NOT NULL,
	"recent_5_pct" numeric(5, 2),
	"recent_10_pct" numeric(5, 2),
	"recent_20pct_period_pct" numeric(5, 2),
	"current_streak" integer DEFAULT 0 NOT NULL,
	"last_occurrence_date" timestamp with time zone,
	"days_since_last_occurrence" integer,
	"status" "pattern_status" NOT NULL,
	"confidence_note" text,
	"occurrences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_configurations" ADD CONSTRAINT "analysis_configurations_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_configurations" ADD CONSTRAINT "analysis_configurations_data_provider_id_data_providers_id_fk" FOREIGN KEY ("data_provider_id") REFERENCES "public"."data_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_operations" ADD CONSTRAINT "backtest_operations_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_operations" ADD CONSTRAINT "backtest_operations_currency_pair_id_currency_pairs_id_fk" FOREIGN KEY ("currency_pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bankroll_configurations" ADD CONSTRAINT "bankroll_configurations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candles" ADD CONSTRAINT "candles_currency_pair_id_currency_pairs_id_fk" FOREIGN KEY ("currency_pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_providers" ADD CONSTRAINT "data_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_data_provider_id_data_providers_id_fk" FOREIGN KEY ("data_provider_id") REFERENCES "public"."data_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "martingale_calculations" ADD CONSTRAINT "martingale_calculations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "martingale_calculations" ADD CONSTRAINT "martingale_calculations_bankroll_configuration_id_bankroll_configurations_id_fk" FOREIGN KEY ("bankroll_configuration_id") REFERENCES "public"."bankroll_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "martingale_levels" ADD CONSTRAINT "martingale_levels_calculation_id_martingale_calculations_id_fk" FOREIGN KEY ("calculation_id") REFERENCES "public"."martingale_calculations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_results" ADD CONSTRAINT "pattern_results_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_results" ADD CONSTRAINT "pattern_results_currency_pair_id_currency_pairs_id_fk" FOREIGN KEY ("currency_pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_user_idx" ON "analyses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analyses_status_idx" ON "analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "backtest_operations_backtest_idx" ON "backtest_operations" USING btree ("backtest_id");--> statement-breakpoint
CREATE INDEX "backtest_operations_date_idx" ON "backtest_operations" USING btree ("operation_date");--> statement-breakpoint
CREATE INDEX "backtests_user_idx" ON "backtests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backtests_status_idx" ON "backtests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candles_pair_tf_opentime_idx" ON "candles" USING btree ("currency_pair_id","timeframe","open_time");--> statement-breakpoint
CREATE UNIQUE INDEX "candles_unique_idx" ON "candles" USING btree ("currency_pair_id","timeframe","open_time","source");--> statement-breakpoint
CREATE UNIQUE INDEX "currency_pairs_symbol_idx" ON "currency_pairs" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "martingale_calculations_user_idx" ON "martingale_calculations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "martingale_levels_calculation_idx" ON "martingale_levels" USING btree ("calculation_id");--> statement-breakpoint
CREATE INDEX "pattern_results_analysis_idx" ON "pattern_results" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "pattern_results_pair_tf_time_idx" ON "pattern_results" USING btree ("currency_pair_id","timeframe","time_of_day");--> statement-breakpoint
CREATE INDEX "pattern_results_repetition_pct_idx" ON "pattern_results" USING btree ("repetition_pct");--> statement-breakpoint
CREATE INDEX "pattern_results_status_idx" ON "pattern_results" USING btree ("status");