-- The admin's applicants (src/server/board/applicants.ts `staffScope`): the board's own jobs
-- (`source` admin / import) are read by id first, then their applications by `job_id`. Without an
-- index that read scans every job (4 ms at 5,000 jobs); with it, 0.1 ms. New index only: safe for
-- the previous code. A job board's jobs table is small: a plain CREATE INDEX.
CREATE INDEX IF NOT EXISTS "jobs_source_id_idx" ON "jobs" ("source", "id");
