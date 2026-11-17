-- The nightly purge's sweep of left-over uploads asks, per upload, whether a profile still uses the
-- file as its photo OR its CV. Only the CV column had an index, so each check read every profile
-- (5 ms at 50k profiles, per upload); with both, it is a bitmap OR of two index lookups (0.15 ms).
-- A small table: a plain CREATE INDEX inside the transaction.
BEGIN;

CREATE INDEX IF NOT EXISTS "applicant_profiles_photo_file_id_idx" ON "applicant_profiles"("photo_file_id");

COMMIT;
