ALTER TABLE "multi_period_pattern_results" ADD COLUMN "total_valid" integer;
--> statement-breakpoint
-- backfill: para as linhas já existentes, total_valid = valid_samples da
-- maior janela ESTRUTURAL (is_momentum = false), nunca a de momentum (40D).
UPDATE "multi_period_pattern_results" r
SET "total_valid" = w."valid_samples"
FROM "multi_period_windows" w
WHERE w."pattern_result_id" = r."id"
  AND w."is_momentum" = false
  AND w."days" = (
    SELECT MAX(w2."days")
    FROM "multi_period_windows" w2
    WHERE w2."pattern_result_id" = r."id" AND w2."is_momentum" = false
  );
--> statement-breakpoint
ALTER TABLE "multi_period_pattern_results" ALTER COLUMN "total_valid" SET NOT NULL;