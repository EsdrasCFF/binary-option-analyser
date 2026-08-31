CREATE TYPE "public"."multi_period_classification" AS ENUM('excelente', 'forte', 'bom', 'observar', 'descartar');--> statement-breakpoint
CREATE TYPE "public"."multi_period_inversion" AS ENUM('none', 'possible', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."multi_period_momentum" AS ENUM('fortalecendo', 'estavel', 'enfraquecendo', 'possivel_inversao');--> statement-breakpoint
CREATE TYPE "public"."multi_period_recommendation" AS ENUM('a_favor', 'contra', 'observar', 'descartar');--> statement-breakpoint
CREATE TABLE "multi_period_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"reference_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "multi_period_analysis_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"currency_pair_ids" jsonb NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"max_days" integer NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"weekdays" jsonb,
	"data_provider_id" uuid,
	"doji_tolerance_pct" numeric(6, 4) DEFAULT '0' NOT NULL,
	"doji_policy" "doji_policy" DEFAULT 'ignore' NOT NULL,
	"persistence_threshold_pct" numeric(5, 2) DEFAULT '70' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multi_period_pattern_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"currency_pair_id" uuid NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"time_of_day" varchar(5) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"direction" "direction" NOT NULL,
	"structural_average" numeric(5, 2) NOT NULL,
	"confidence_score" integer NOT NULL,
	"classification" "multi_period_classification" NOT NULL,
	"recommendation" "multi_period_recommendation" NOT NULL,
	"momentum_trend" "multi_period_momentum" NOT NULL,
	"inversion_state" "multi_period_inversion" NOT NULL,
	"persistence_confirmed" integer NOT NULL,
	"persistence_total" integer NOT NULL,
	"persistence_percentage" numeric(5, 2) NOT NULL,
	"stability_range" numeric(6, 2) NOT NULL,
	"stability_std_dev" numeric(6, 2) NOT NULL,
	"sample_min" integer NOT NULL,
	"score_persistence" numeric(5, 2) NOT NULL,
	"score_frequency" numeric(5, 2) NOT NULL,
	"score_stability" numeric(5, 2) NOT NULL,
	"score_sample" numeric(5, 2) NOT NULL,
	"score_momentum" numeric(5, 2) NOT NULL,
	"recent_momentum_frequency" numeric(5, 2) NOT NULL,
	"recent_momentum_opposite_frequency" numeric(5, 2) NOT NULL,
	"recent_momentum_valid_samples" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multi_period_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern_result_id" uuid NOT NULL,
	"days" integer NOT NULL,
	"is_momentum" boolean DEFAULT false NOT NULL,
	"frequency" numeric(5, 2) NOT NULL,
	"valid_samples" integer NOT NULL,
	"call_count" integer NOT NULL,
	"put_count" integer NOT NULL,
	"doji_count" integer NOT NULL,
	"occurrences" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "multi_period_analyses" ADD CONSTRAINT "multi_period_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_period_analysis_configurations" ADD CONSTRAINT "multi_period_analysis_configurations_analysis_id_multi_period_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."multi_period_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_period_analysis_configurations" ADD CONSTRAINT "multi_period_analysis_configurations_data_provider_id_data_providers_id_fk" FOREIGN KEY ("data_provider_id") REFERENCES "public"."data_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_period_pattern_results" ADD CONSTRAINT "multi_period_pattern_results_analysis_id_multi_period_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."multi_period_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_period_pattern_results" ADD CONSTRAINT "multi_period_pattern_results_currency_pair_id_currency_pairs_id_fk" FOREIGN KEY ("currency_pair_id") REFERENCES "public"."currency_pairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_period_windows" ADD CONSTRAINT "multi_period_windows_pattern_result_id_multi_period_pattern_results_id_fk" FOREIGN KEY ("pattern_result_id") REFERENCES "public"."multi_period_pattern_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "multi_period_analyses_user_idx" ON "multi_period_analyses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "multi_period_analyses_status_idx" ON "multi_period_analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "multi_period_pattern_results_analysis_idx" ON "multi_period_pattern_results" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "multi_period_pattern_results_score_idx" ON "multi_period_pattern_results" USING btree ("confidence_score");--> statement-breakpoint
CREATE INDEX "multi_period_windows_pattern_result_idx" ON "multi_period_windows" USING btree ("pattern_result_id");