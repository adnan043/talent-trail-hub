BEGIN;

-- AlterTable
ALTER TABLE "board_settings" ADD COLUMN "sidebar_bg" VARCHAR(7),
ADD COLUMN "sidebar_text" VARCHAR(7);

ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_sidebar_bg_check" CHECK ("sidebar_bg" IS NULL OR "sidebar_bg" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_sidebar_text_check" CHECK ("sidebar_text" IS NULL OR "sidebar_text" ~ '^#[0-9a-f]{6}$');

COMMIT;
