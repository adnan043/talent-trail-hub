-- Status emails: at most ONE shortlisted (status_emailed_at) and ONE rejected email per application,
-- so a candidate shortlisted and later rejected still hears the outcome.
BEGIN;

ALTER TABLE "applications" ADD COLUMN "rejected_emailed_at" TIMESTAMPTZ(3);

COMMIT;
