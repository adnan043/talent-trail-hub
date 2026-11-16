-- A job page's "similar jobs" (src/server/routes/jobs.ts: same category, featured first, then
-- newest) sorted every live job of the category to return 3: the older category index does not
-- start the order with is_featured. With this one it reads 3 index entries. New index only: safe
-- for the previous code. A job board's jobs table is small: a plain CREATE INDEX.
CREATE INDEX "jobs_category_id_status_is_featured_published_at_id_idx" ON "jobs"("category_id", "status", "is_featured" DESC, "published_at" DESC, "id" DESC);
