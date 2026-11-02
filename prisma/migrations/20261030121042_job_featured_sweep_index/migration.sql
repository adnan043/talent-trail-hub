-- The hourly featured sweep (src/server/board/tasks.ts) filters on these two, any status.
BEGIN;

CREATE INDEX "jobs_is_featured_featured_until_idx" ON "jobs"("is_featured", "featured_until");

COMMIT;
