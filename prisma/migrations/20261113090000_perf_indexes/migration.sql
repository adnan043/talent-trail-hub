-- Indexes for the query shapes the performance audit found unserved (one per shape), and the
-- keyword search column. Small tables (a job board's jobs, companies and tags): plain
-- CREATE INDEX inside the transaction. Every statement is safe for the previous code too
-- (a new column with a default, new indexes, triggers that only fill that column).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Keyword search (src/server/board/public-search.ts): every term must appear in the title, the
-- company's name, a tag or the description. Spread over four tables, `ILIKE '%term%'` could only
-- read every live job (an OR across sub-queries never uses an index). One lower-cased column
-- holding all four, kept by the triggers below on every write, and a trigram GIN index on it:
-- each term is one indexed ILIKE, several terms are ANDed bitmaps. Code never writes it.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "search_text" TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION "board_job_search_text"(p_job_id INTEGER, p_title TEXT, p_company_id INTEGER, p_description TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT lower(concat_ws(E'\n',
    p_title,
    (SELECT c."name" FROM "companies" c WHERE c."id" = p_company_id),
    (SELECT string_agg(t."name", E'\n' ORDER BY t."name") FROM "job_tags" jt JOIN "tags" t ON t."id" = jt."tag_id" WHERE jt."job_id" = p_job_id),
    p_description
  ))
$$;

-- A job's own columns: computed before the row is written (no second write).
CREATE OR REPLACE FUNCTION "board_jobs_search_text_row"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."search_text" := "board_job_search_text"(NEW."id", NEW."title", NEW."company_id", NEW."description_md");
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "jobs_search_text" ON "jobs";
CREATE TRIGGER "jobs_search_text" BEFORE INSERT OR UPDATE OF "title", "description_md", "company_id" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "board_jobs_search_text_row"();

-- A tag added to or removed from a job (a deleted job's rows: the job is already gone, no-op).
CREATE OR REPLACE FUNCTION "board_job_tags_search_text"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_job_id INTEGER := CASE WHEN TG_OP = 'DELETE' THEN OLD."job_id" ELSE NEW."job_id" END;
BEGIN
  UPDATE "jobs" j SET "search_text" = "board_job_search_text"(j."id", j."title", j."company_id", j."description_md")
  WHERE j."id" = v_job_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS "job_tags_search_text" ON "job_tags";
CREATE TRIGGER "job_tags_search_text" AFTER INSERT OR DELETE ON "job_tags"
  FOR EACH ROW EXECUTE FUNCTION "board_job_tags_search_text"();

-- A company renamed: its jobs' text follows.
CREATE OR REPLACE FUNCTION "board_companies_search_text"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "jobs" j SET "search_text" = "board_job_search_text"(j."id", j."title", j."company_id", j."description_md")
  WHERE j."company_id" = NEW."id";
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS "companies_search_text" ON "companies";
CREATE TRIGGER "companies_search_text" AFTER UPDATE OF "name" ON "companies"
  FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name") EXECUTE FUNCTION "board_companies_search_text"();

-- The jobs already there (a job board's table: one statement is fine).
UPDATE "jobs" j SET "search_text" = "board_job_search_text"(j."id", j."title", j."company_id", j."description_md");

CREATE INDEX IF NOT EXISTS "jobs_search_text_trgm_idx" ON "jobs" USING GIN ("search_text" gin_trgm_ops);

-- The location filter: city OR region ILIKE '%place%' (a bitmap OR of these two).
CREATE INDEX IF NOT EXISTS "jobs_location_city_trgm_idx" ON "jobs" USING GIN ("location_city" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "jobs_location_region_trgm_idx" ON "jobs" USING GIN ("location_region" gin_trgm_ops);

-- /jobs?sort=salary: ORDER BY salary_max_cents DESC NULLS LAST, id DESC on the published jobs.
-- NULLS LAST is SQL only (Prisma's @@index cannot say it; the schema's @@index has the same name).
CREATE INDEX IF NOT EXISTS "jobs_status_salary_max_cents_id_idx" ON "jobs" ("status", "salary_max_cents" DESC NULLS LAST, "id" DESC);

-- The moderation queue: status = 'pending_review' ORDER BY flagged DESC, id ASC (keyset).
CREATE INDEX IF NOT EXISTS "jobs_status_flagged_id_idx" ON "jobs" ("status", "flagged" DESC, "id");

-- The companies directory and "Hiring now": not blocked, most open jobs first, then id.
CREATE INDEX IF NOT EXISTS "companies_is_blocked_active_job_count_id_idx" ON "companies" ("is_blocked", "active_job_count" DESC, "id");

-- The purge job deletes email log rows past their retention by created_at.
CREATE INDEX IF NOT EXISTS "email_logs_created_at_idx" ON "email_logs" ("created_at");

-- /applications/all/jobs: jobs with applications, newest first. Partial (SQL only: Prisma cannot
-- express it; delete any DROP of it from a later --create-only migration).
CREATE INDEX IF NOT EXISTS "jobs_with_applications_idx" ON "jobs" ("id" DESC) WHERE "application_count" > 0;

COMMIT;
