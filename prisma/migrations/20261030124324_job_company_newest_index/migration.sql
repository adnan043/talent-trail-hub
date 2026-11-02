-- The employer's "my jobs": one company, every status, newest first.
BEGIN;

CREATE INDEX "jobs_company_id_id_idx" ON "jobs"("company_id", "id" DESC);

COMMIT;
