BEGIN;

-- CreateTable
CREATE TABLE "company_logos" (
    "company_id" INTEGER NOT NULL,
    "content_type" VARCHAR(12) NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_logos_pkey" PRIMARY KEY ("company_id")
);

-- AddForeignKey
ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_size_check" CHECK (octet_length("data") <= 49152);

COMMIT;
