BEGIN;

-- CreateTable
CREATE TABLE "board_logo" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "content_type" VARCHAR(12) NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "board_logo_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "board_logo" ADD CONSTRAINT "board_logo_one_row_check" CHECK ("id" = 1);
ALTER TABLE "board_logo" ADD CONSTRAINT "board_logo_size_check" CHECK (octet_length("data") <= 49152);

COMMIT;
