-- An email address can pass to a new account (an account changed its address, or was deleted, and
-- someone else signed up with it). One application per job per ACCOUNT is the rule now; one per
-- address per job stays only for the old guest applications (no account). A partial index: SQL only.
BEGIN;

DROP INDEX IF EXISTS "applications_job_id_email_key";
CREATE UNIQUE INDEX "applications_job_id_guest_email_key" ON "applications"("job_id", "email") WHERE "applicant_user_id" IS NULL;

COMMIT;
