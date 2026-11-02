-- Indexes for the query shapes the performance review found unserved (one per shape).
-- Replaced indexes are this board's own, from the job_board migration.
BEGIN;

DROP INDEX "email_logs_created_at_id_idx";
DROP INDEX "email_logs_to_address_idx";
DROP INDEX "jobs_category_id_status_idx";
CREATE INDEX "applications_job_id_id_idx" ON "applications"("job_id", "id" DESC);
CREATE INDEX "applications_status_id_idx" ON "applications"("status", "id" DESC);
CREATE INDEX "email_logs_status_id_idx" ON "email_logs"("status", "id" DESC);
CREATE INDEX "email_logs_to_address_id_idx" ON "email_logs"("to_address", "id" DESC);
CREATE INDEX "jobs_category_id_status_published_at_id_idx" ON "jobs"("category_id", "status", "published_at" DESC, "id" DESC);
CREATE INDEX "jobs_status_id_idx" ON "jobs"("status", "id");

-- The resume purge reads only applications that still hold a file (SQL only: Prisma cannot
-- express a partial index; delete any DROP of it from a later --create-only migration).
CREATE INDEX "applications_purge_idx" ON "applications" ("created_at", "id") WHERE "resume_file_id" IS NOT NULL;

COMMIT;
