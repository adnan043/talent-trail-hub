-- The admin's job search and the dashboard's ⌘K search (src/server/board/manage-jobs.ts:
-- `title ILIKE '%term%'`, newest first) walked the whole jobs table whenever few or no titles
-- matched (5 ms at 5,000 jobs, growing with the board). A trigram index finds them directly
-- (0.2 ms). New index only: safe for the previous code. pg_trgm is already on
-- (20261113090000_perf_indexes). A job board's jobs table is small: a plain CREATE INDEX.
CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING GIN ("title" gin_trgm_ops);
