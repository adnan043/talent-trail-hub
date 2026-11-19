-- Two more starter categories, so the home page's category grid fills two rows of four.
-- Data only; a board that already has these slugs keeps its own.
BEGIN;

INSERT INTO "categories" ("name", "slug", "sort_order", "updated_at") VALUES
  ('Sales', 'sales', 6, CURRENT_TIMESTAMP),
  ('Customer Support', 'customer-support', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

COMMIT;
