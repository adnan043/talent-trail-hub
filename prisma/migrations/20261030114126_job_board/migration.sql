-- Talent Trail Hub's job board (docs/agent/database.md). Wrapped in one transaction.
-- The template's demo `jobs` table becomes the board's: this is a NEW site, so its only rows are
-- the template's demo seed (prisma/seed.sql), removed first so the required columns can be added.
BEGIN;

DELETE FROM "jobs";

-- DropIndex
DROP INDEX "jobs_status_id_idx";

-- AlterTable
ALTER TABLE "jobs" DROP COLUMN "apply_url",
DROP COLUMN "company",
DROP COLUMN "description",
DROP COLUMN "location",
DROP COLUMN "remote",
DROP COLUMN "type",
ADD COLUMN     "applicant_countries" JSONB,
ADD COLUMN     "application_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "apply_click_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "apply_method" VARCHAR(6) NOT NULL DEFAULT 'onsite',
ADD COLUMN     "apply_target" VARCHAR(500),
ADD COLUMN     "category_id" INTEGER NOT NULL,
ADD COLUMN     "company_id" INTEGER NOT NULL,
ADD COLUMN     "description_html" VARCHAR(30000) NOT NULL,
ADD COLUMN     "description_md" VARCHAR(10000) NOT NULL,
ADD COLUMN     "duration_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "employment_type" VARCHAR(12) NOT NULL,
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "expiry_reminder_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "featured_until" TIMESTAMPTZ(3),
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_seed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "listing_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "location_city" VARCHAR(80),
ADD COLUMN     "location_country" CHAR(2),
ADD COLUMN     "location_region" VARCHAR(80),
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "rejection_reason" VARCHAR(500),
ADD COLUMN     "salary_currency" CHAR(3),
ADD COLUMN     "salary_max_cents" INTEGER,
ADD COLUMN     "salary_min_cents" INTEGER,
ADD COLUMN     "salary_period" VARCHAR(5),
ADD COLUMN     "source" VARCHAR(8) NOT NULL DEFAULT 'paid',
ADD COLUMN     "tier_id" INTEGER,
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workplace_type" VARCHAR(8) NOT NULL,
ALTER COLUMN "title" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "status" SET DEFAULT 'draft',
ALTER COLUMN "status" SET DATA TYPE VARCHAR(16),
ALTER COLUMN "created_by" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "board_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(80) NOT NULL DEFAULT 'Talent Trail Hub',
    "logo_file_id" VARCHAR(32),
    "logo_url" VARCHAR(500),
    "primary_color" VARCHAR(7) NOT NULL DEFAULT '#4f46e5',
    "font_preset" VARCHAR(10) NOT NULL DEFAULT 'inter',
    "hero_title" VARCHAR(120) NOT NULL DEFAULT 'Find your next role',
    "hero_subtitle" VARCHAR(240) NOT NULL DEFAULT 'Hand-picked jobs from companies that are hiring now.',
    "footer_links" JSONB NOT NULL DEFAULT '[]',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "moderation_mode" VARCHAR(12) NOT NULL DEFAULT 'all',
    "free_posting_enabled" BOOLEAN NOT NULL DEFAULT false,
    "board_mode" VARCHAR(16) NOT NULL DEFAULT 'marketplace',
    "owner_company_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "board_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "owner_user_id" INTEGER,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "logo_file_id" VARCHAR(32),
    "logo_url" VARCHAR(500),
    "website" VARCHAR(300),
    "about_html" VARCHAR(6000),
    "location" VARCHAR(80),
    "socials" JSONB,
    "is_trusted" BOOLEAN NOT NULL DEFAULT false,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(10) NOT NULL DEFAULT 'employer',
    "active_job_count" INTEGER NOT NULL DEFAULT 0,
    "is_seed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_tags" (
    "job_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_tags_pkey" PRIMARY KEY ("job_id","tag_id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "profile_url" VARCHAR(300),
    "cover_note" VARCHAR(3000),
    "resume_file_id" VARCHAR(32),
    "resume_file_name" VARCHAR(200),
    "status" VARCHAR(12) NOT NULL DEFAULT 'new',
    "employer_notes" VARCHAR(5000),
    "status_emailed_at" TIMESTAMPTZ(3),
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_text" VARCHAR(1000) NOT NULL,
    "ip_hash" CHAR(64),
    "is_seed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_uploads" (
    "id" SERIAL NOT NULL,
    "token" VARCHAR(43) NOT NULL,
    "file_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(127) NOT NULL,
    "size" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "application_id" INTEGER,
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resume_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_tiers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "price_key" VARCHAR(63),
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "duration_days" INTEGER NOT NULL DEFAULT 30,
    "includes_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_orders" (
    "id" SERIAL NOT NULL,
    "checkout_id" VARCHAR(80),
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "job_id" INTEGER,
    "tier_id" INTEGER,
    "kind" VARCHAR(6) NOT NULL DEFAULT 'new',
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "price_key" VARCHAR(63),
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "tier_name" VARCHAR(40) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "includes_featured" BOOLEAN NOT NULL DEFAULT false,
    "receipt_url" VARCHAR(500),
    "paid_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" BIGSERIAL NOT NULL,
    "template_key" VARCHAR(40) NOT NULL,
    "to_address" VARCHAR(254) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_attempts" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_settings_owner_company_id_idx" ON "board_settings"("owner_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_owner_user_id_key" ON "companies"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "companies_is_blocked_name_id_idx" ON "companies"("is_blocked", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_is_active_sort_order_id_idx" ON "categories"("is_active", "sort_order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "job_tags_tag_id_job_id_idx" ON "job_tags"("tag_id", "job_id");

-- CreateIndex
CREATE INDEX "applications_job_id_status_id_idx" ON "applications"("job_id", "status", "id" DESC);

-- CreateIndex
CREATE INDEX "applications_email_id_idx" ON "applications"("email", "id");

-- CreateIndex
CREATE INDEX "applications_created_at_id_idx" ON "applications"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_job_id_email_key" ON "applications"("job_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "resume_uploads_token_key" ON "resume_uploads"("token");

-- CreateIndex
CREATE UNIQUE INDEX "resume_uploads_file_id_key" ON "resume_uploads"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_uploads_application_id_key" ON "resume_uploads"("application_id");

-- CreateIndex
CREATE INDEX "resume_uploads_application_id_created_at_idx" ON "resume_uploads"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_tiers_is_active_sort_order_id_idx" ON "listing_tiers"("is_active", "sort_order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_orders_checkout_id_key" ON "listing_orders"("checkout_id");

-- CreateIndex
CREATE INDEX "listing_orders_company_id_id_idx" ON "listing_orders"("company_id", "id" DESC);

-- CreateIndex
CREATE INDEX "listing_orders_job_id_id_idx" ON "listing_orders"("job_id", "id");

-- CreateIndex
CREATE INDEX "listing_orders_tier_id_idx" ON "listing_orders"("tier_id");

-- CreateIndex
CREATE INDEX "listing_orders_status_paid_at_idx" ON "listing_orders"("status", "paid_at");

-- CreateIndex
CREATE INDEX "email_logs_created_at_id_idx" ON "email_logs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "email_logs_to_address_idx" ON "email_logs"("to_address");

-- CreateIndex
CREATE INDEX "board_attempts_kind_ip_hash_created_at_idx" ON "board_attempts"("kind", "ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "board_attempts_created_at_idx" ON "board_attempts"("created_at");

-- CreateIndex
CREATE INDEX "jobs_status_published_at_id_idx" ON "jobs"("status", "published_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_is_featured_featured_until_idx" ON "jobs"("status", "is_featured", "featured_until");

-- CreateIndex
CREATE INDEX "jobs_category_id_status_idx" ON "jobs"("category_id", "status");

-- CreateIndex
CREATE INDEX "jobs_company_id_status_id_idx" ON "jobs"("company_id", "status", "id");

-- CreateIndex
CREATE INDEX "jobs_status_expires_at_idx" ON "jobs"("status", "expires_at");

-- CreateIndex
CREATE INDEX "jobs_tier_id_idx" ON "jobs"("tier_id");

-- AddForeignKey
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_owner_company_id_fkey" FOREIGN KEY ("owner_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "listing_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_tags" ADD CONSTRAINT "job_tags_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_tags" ADD CONSTRAINT "job_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_orders" ADD CONSTRAINT "listing_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_orders" ADD CONSTRAINT "listing_orders_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_orders" ADD CONSTRAINT "listing_orders_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "listing_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Small fixed sets (validated in the routes too).
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_moderation_check" CHECK ("moderation_mode" IN ('all', 'first_post', 'auto'));
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_mode_check" CHECK ("board_mode" IN ('marketplace', 'single_company'));
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_font_check" CHECK ("font_preset" IN ('inter', 'serif', 'mono'));
ALTER TABLE "companies" ADD CONSTRAINT "companies_source_check" CHECK ("source" IN ('employer', 'admin', 'import'));
ALTER TABLE "companies" ADD CONSTRAINT "companies_active_jobs_check" CHECK ("active_job_count" >= 0);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check" CHECK ("status" IN ('draft', 'pending_payment', 'pending_review', 'published', 'rejected', 'expired', 'closed'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_check" CHECK ("source" IN ('paid', 'credit', 'free', 'admin', 'import'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_employment_type_check" CHECK ("employment_type" IN ('FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY', 'INTERN'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workplace_type_check" CHECK ("workplace_type" IN ('onsite', 'hybrid', 'remote'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_apply_method_check" CHECK ("apply_method" IN ('onsite', 'url', 'email'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_period_check" CHECK ("salary_period" IS NULL OR "salary_period" IN ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_check" CHECK ("salary_min_cents" IS NULL OR "salary_max_cents" IS NULL OR "salary_min_cents" <= "salary_max_cents");
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_counts_check" CHECK ("view_count" >= 0 AND "apply_click_count" >= 0 AND "application_count" >= 0);
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check" CHECK ("status" IN ('new', 'reviewed', 'shortlisted', 'rejected'));
ALTER TABLE "listing_tiers" ADD CONSTRAINT "listing_tiers_days_check" CHECK ("duration_days" BETWEEN 1 AND 120);
ALTER TABLE "listing_tiers" ADD CONSTRAINT "listing_tiers_price_check" CHECK ("price_cents" >= 0);
ALTER TABLE "listing_orders" ADD CONSTRAINT "listing_orders_status_check" CHECK ("status" IN ('pending', 'paid', 'refunded', 'failed'));
ALTER TABLE "listing_orders" ADD CONSTRAINT "listing_orders_kind_check" CHECK ("kind" IN ('new', 'renew'));
ALTER TABLE "listing_orders" ADD CONSTRAINT "listing_orders_amount_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_status_check" CHECK ("status" IN ('sent', 'failed', 'skipped'));

-- Defaults every board starts with (idempotent).
INSERT INTO "board_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "listing_tiers" ("name", "price_key", "price_cents", "currency", "duration_days", "includes_featured", "sort_order", "updated_at")
SELECT 'Standard', 'listing-standard-30', 9900, 'USD', 30, false, 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "listing_tiers");
INSERT INTO "categories" ("name", "slug", "sort_order", "updated_at") VALUES
  ('Design', 'design', 0, CURRENT_TIMESTAMP),
  ('Engineering', 'engineering', 1, CURRENT_TIMESTAMP),
  ('Marketing', 'marketing', 2, CURRENT_TIMESTAMP),
  ('Operations', 'operations', 3, CURRENT_TIMESTAMP),
  ('Coaching', 'coaching', 4, CURRENT_TIMESTAMP),
  ('Content', 'content', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

COMMIT;
