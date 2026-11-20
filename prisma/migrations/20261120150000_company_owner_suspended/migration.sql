-- 1. A company whose employer account is suspended (or deleted) leaves the public board, like a
-- blocked company, without touching `is_blocked` (the moderators' own switch): reactivating the
-- account brings the jobs back. Suspending happens in the managed platform code, so a trigger on
-- `users` keeps the flag; code never writes it.
-- 2. Admin or import jobs that sit in a company with an employer account belong to that employer
-- from now on: they become employer jobs (`free`, nothing was paid), so the employer reviews their
-- applicants and the admin can no longer edit them. Admins post only for ownerless companies now.
-- Safe for the previous code (a new column with a default, a trigger that only fills it).
BEGIN;

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "owner_suspended" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION "board_users_owner_suspended"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "companies" SET "owner_suspended" = true WHERE "owner_user_id" = OLD."id" AND NOT "owner_suspended";
    RETURN OLD;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    UPDATE "companies" SET "owner_suspended" = (NEW."status" <> 'active') WHERE "owner_user_id" = NEW."id";
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "users_owner_suspended" ON "users";
CREATE TRIGGER "users_owner_suspended" AFTER UPDATE OF "status" OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION "board_users_owner_suspended"();

-- The owners already suspended or gone.
UPDATE "companies" c SET "owner_suspended" = true
WHERE c."owner_user_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = c."owner_user_id" AND u."status" = 'active');

-- Old admin / import jobs in employer companies go to the employer.
UPDATE "jobs" j SET "source" = 'free'
FROM "companies" c
WHERE c."id" = j."company_id" AND c."owner_user_id" IS NOT NULL AND j."source" IN ('admin', 'import');

COMMIT;
