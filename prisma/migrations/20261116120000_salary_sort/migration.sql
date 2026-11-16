-- /jobs?sort=salary ordered by salary_max_cents alone: a job with only a minimum sank to the
-- bottom, and an hourly 50 sat below a yearly 60. One column holds the YEARLY amount (the
-- maximum, else the minimum, times the periods per year: the same table as PERIODS_PER_YEAR in
-- src/server/board/public-search.ts), kept by a trigger on every write; code never writes it.
-- BIGINT: an hourly 21,000,000 a year is past int4. Safe for the previous code (a new nullable
-- column, a trigger that only fills it, a new index; the old index goes after).
BEGIN;

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "salary_sort_cents" BIGINT;

CREATE OR REPLACE FUNCTION "board_jobs_salary_sort_row"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."salary_sort_cents" := COALESCE(NEW."salary_max_cents", NEW."salary_min_cents")::BIGINT *
    CASE NEW."salary_period" WHEN 'HOUR' THEN 2080 WHEN 'DAY' THEN 260 WHEN 'WEEK' THEN 52 WHEN 'MONTH' THEN 12 ELSE 1 END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "jobs_salary_sort" ON "jobs";
CREATE TRIGGER "jobs_salary_sort" BEFORE INSERT OR UPDATE OF "salary_min_cents", "salary_max_cents", "salary_period" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "board_jobs_salary_sort_row"();

-- The jobs already there (fires the trigger).
UPDATE "jobs" SET "salary_period" = "salary_period" WHERE "salary_min_cents" IS NOT NULL OR "salary_max_cents" IS NOT NULL;

-- ORDER BY salary_sort_cents DESC NULLS LAST, id DESC on the published jobs (NULLS LAST is SQL
-- only; the schema's @@index has the same name).
CREATE INDEX IF NOT EXISTS "jobs_status_salary_sort_cents_id_idx" ON "jobs" ("status", "salary_sort_cents" DESC NULLS LAST, "id" DESC);
DROP INDEX IF EXISTS "jobs_status_salary_max_cents_id_idx";

COMMIT;
