-- Local development only: applicant photo and CV bytes when there is no file storage (no Site Key).
BEGIN;

-- CreateTable
CREATE TABLE "local_dev_files" (
    "id" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_dev_files_pkey" PRIMARY KEY ("id")
);

COMMIT;
