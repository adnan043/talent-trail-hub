BEGIN;

ALTER TABLE "board_settings" ADD COLUMN "favicon_file_id" VARCHAR(32),
ADD COLUMN "favicon_url" VARCHAR(500);

COMMIT;
