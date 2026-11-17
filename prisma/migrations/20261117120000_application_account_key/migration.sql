-- An application belongs to the applicant's ACCOUNT, not only to its email: the email can change
-- after applying. One application per account per job, and an index for "My applications".
BEGIN;

CREATE UNIQUE INDEX "applications_job_id_applicant_user_id_key" ON "applications"("job_id", "applicant_user_id");
CREATE INDEX "applications_applicant_user_id_id_idx" ON "applications"("applicant_user_id", "id");

COMMIT;
