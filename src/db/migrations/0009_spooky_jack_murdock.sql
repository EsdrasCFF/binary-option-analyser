ALTER TABLE "analysis_configurations" ALTER COLUMN "top_n" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "analysis_configurations" ALTER COLUMN "top_n" DROP NOT NULL;