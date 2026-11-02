-- The board's default brand colour is the original design's terracotta. A board still on the
-- old indigo default (never changed by its admin) moves to it too.
BEGIN;

ALTER TABLE "board_settings" ALTER COLUMN "primary_color" SET DEFAULT '#a63d23';
UPDATE "board_settings" SET "primary_color" = '#a63d23', "updated_at" = CURRENT_TIMESTAMP WHERE "primary_color" = '#4f46e5';

COMMIT;
