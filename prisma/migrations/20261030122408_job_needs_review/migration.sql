-- Employer edits mark a job as needing review until a moderator approves it (expand: a default,
-- so the previous code keeps working). Jobs already waiting in review start marked.
BEGIN;

ALTER TABLE "jobs" ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;
UPDATE "jobs" SET "needs_review" = true WHERE "status" = 'pending_review';

COMMIT;
