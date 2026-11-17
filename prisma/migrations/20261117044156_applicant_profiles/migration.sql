-- Applicant accounts: a job seeker's profile (photo, CV and the details every application sends),
-- the applicant's account on each new application, and the new "approved" status (emailed once).
BEGIN;

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "applicant_user_id" INTEGER,
ADD COLUMN     "approved_emailed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "applicant_profiles" (
    "user_id" INTEGER NOT NULL,
    "phone" VARCHAR(40),
    "date_of_birth" DATE,
    "gender" VARCHAR(8),
    "present_address" VARCHAR(300),
    "permanent_address" VARCHAR(300),
    "headline" VARCHAR(120),
    "career_summary" VARCHAR(2000),
    "experience_years" INTEGER,
    "expected_salary" VARCHAR(60),
    "degree" VARCHAR(150),
    "institute" VARCHAR(150),
    "passing_year" INTEGER,
    "skills" VARCHAR(500),
    "profile_url" VARCHAR(300),
    "photo_file_id" VARCHAR(32),
    "resume_file_id" VARCHAR(32),
    "resume_file_name" VARCHAR(200),
    "resume_updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applicant_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "applicant_profiles_resume_file_id_idx" ON "applicant_profiles"("resume_file_id");

-- CreateIndex
CREATE INDEX "applications_resume_file_id_idx" ON "applications"("resume_file_id");

ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'other'));
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_numbers_check"
  CHECK (("experience_years" IS NULL OR "experience_years" BETWEEN 0 AND 60) AND ("passing_year" IS NULL OR "passing_year" BETWEEN 1950 AND 2100));

ALTER TABLE "applications" DROP CONSTRAINT "applications_status_check";
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check" CHECK ("status" IN ('new', 'reviewed', 'shortlisted', 'approved', 'rejected'));

COMMIT;
