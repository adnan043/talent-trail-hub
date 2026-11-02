-- Fake starter data for the PREVIEW Database only: the editor runs it after
-- `npx prisma migrate reset`, or on demand with `npx prisma db seed`.
-- Live data never comes from here. No users: create them by signing up.
--
-- The board's demo (old SPEC "Defaults (seed)"): 4 companies with no owner (admin companies),
-- 8 jobs (2 featured, 2 remote, 1 expired, 1 waiting for review, 1 applying on an external
-- site), 5 applications without resumes, and dummy Basic and Featured listing tiers. Every
-- board row has is_seed = true (tiers have no such column). Dates are relative to now(), so the
-- jobs are current whenever it runs. Categories, the Standard tier and the board settings come
-- from the job_board migration. Safe to run twice: every insert skips a row that already exists
-- (by slug, by name, by job + email, by tier price key).

BEGIN;

INSERT INTO "companies" ("name", "slug", "website", "location", "about_html", "source", "is_trusted", "is_seed", "updated_at")
SELECT v.name, v.slug, v.website, v.location, v.about, 'admin', true, true, now()
FROM (VALUES
  ('Northwind Studio', 'northwind-studio', 'https://northwind.example', 'Berlin, Germany',
   '<p>An independent product design studio working with climate and health startups.</p>'),
  ('Lumen Labs', 'lumen-labs', 'https://lumenlabs.example', 'Austin, USA',
   '<p>Lumen Labs builds scheduling software used by 4,000 clinics.</p>'),
  ('Brightpath Coaching', 'brightpath-coaching', 'https://brightpath.example', 'London, UK',
   '<p>Brightpath pairs first-time managers with experienced leadership coaches.</p>'),
  ('Fieldnote Media', 'fieldnote-media', 'https://fieldnote.example', 'Toronto, Canada',
   '<p>A small content agency writing for B2B software companies.</p>')
) AS v(name, slug, website, location, about)
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug" = v.slug);

-- state: published N days ago (30-day listing), featured for the whole listing, expired, pending.
INSERT INTO "jobs" (
  "company_id", "category_id", "title", "slug", "description_html", "description_md",
  "employment_type", "workplace_type", "location_city", "location_region", "location_country",
  "applicant_countries", "salary_min_cents", "salary_max_cents", "salary_currency", "salary_period",
  "apply_method", "apply_target", "status", "source", "is_featured", "featured_until",
  "published_at", "expires_at", "duration_days", "listing_featured", "view_count", "is_seed", "updated_at"
)
SELECT co."id", ca."id", v.title, v.slug, v.html, v.md,
  v.employment, v.workplace, v.city, v.region, v.country,
  v.countries::jsonb, v.smin, v.smax, v.scur, v.speriod,
  v.method, v.target, v.status, 'admin',
  v.featured, CASE WHEN v.featured THEN now() + make_interval(days => 30 - v.days_ago) END,
  CASE WHEN v.status <> 'pending_review' THEN now() - make_interval(days => v.days_ago) END,
  CASE WHEN v.status <> 'pending_review' THEN now() + make_interval(days => 30 - v.days_ago) END,
  30, v.featured, v.views, true, now()
FROM (VALUES
  ('northwind-studio', 'design', 'Senior Product Designer', 'senior-product-designer-northwind',
   '<p>Northwind Studio is looking for a senior product designer to lead projects for two health-tech clients.</p><h3>What you will do</h3><ul><li>Own end-to-end design from discovery to shipped UI</li><li>Grow and maintain our client design systems</li><li>Run usability sessions with real patients and clinicians</li></ul><h3>About you</h3><p>You have <strong>5+ years</strong> of product design experience and a portfolio that shows your process, not just the final screens.</p>',
   E'Northwind Studio is looking for a senior product designer to lead projects for two health-tech clients.\n\n### What you will do\n\n- Own end-to-end design from discovery to shipped UI\n- Grow and maintain our client design systems\n- Run usability sessions with real patients and clinicians\n\n### About you\n\nYou have **5+ years** of product design experience and a portfolio that shows your process, not just the final screens.',
   'FULL_TIME', 'hybrid', 'Berlin', NULL, 'DE', NULL, 7000000, 9000000, 'EUR', 'YEAR',
   'onsite', NULL, 'published', 2, true, 184),
  ('lumen-labs', 'engineering', 'Frontend Engineer (React)', 'frontend-engineer-react-lumen',
   '<p>Join the four-person web team that builds the Lumen scheduling app used by thousands of clinic staff every day.</p><h3>The work</h3><ul><li>Build accessible React and TypeScript features end to end</li><li>Improve performance on low-powered front-desk computers</li><li>Pair with design on our component library</li></ul><p>We work fully remotely across North American time zones and meet in person twice a year.</p>',
   E'Join the four-person web team that builds the Lumen scheduling app used by thousands of clinic staff every day.\n\n### The work\n\n- Build accessible React and TypeScript features end to end\n- Improve performance on low-powered front-desk computers\n- Pair with design on our component library\n\nWe work fully remotely across North American time zones and meet in person twice a year.',
   'FULL_TIME', 'remote', NULL, NULL, NULL, '["US","CA"]', 12000000, 15000000, 'USD', 'YEAR',
   'onsite', NULL, 'published', 1, true, 241),
  ('brightpath-coaching', 'coaching', 'Leadership Coach (Freelance)', 'leadership-coach-freelance-brightpath',
   '<p>Brightpath is growing its bench of freelance leadership coaches who work with first-time managers at tech companies.</p><h3>What we offer</h3><ul><li>A steady stream of matched coachees</li><li>Flexible hours, fully remote sessions</li><li>Peer supervision every month</li></ul><p>You hold an ICF credential (ACC or above) and have coached at least 100 hours.</p>',
   E'Brightpath is growing its bench of freelance leadership coaches who work with first-time managers at tech companies.\n\n### What we offer\n\n- A steady stream of matched coachees\n- Flexible hours, fully remote sessions\n- Peer supervision every month\n\nYou hold an ICF credential (ACC or above) and have coached at least 100 hours.',
   'CONTRACTOR', 'remote', NULL, NULL, NULL, '["GB","IE"]', 6000, 9000, 'GBP', 'HOUR',
   'url', 'https://brightpath.example/careers/leadership-coach', 'published', 5, false, 97),
  ('fieldnote-media', 'content', 'Content Strategist', 'content-strategist-fieldnote',
   '<p>Fieldnote Media writes long-form content for B2B software companies. We need a strategist to plan editorial calendars with clients.</p><h3>You will</h3><ul><li>Interview subject-matter experts and turn calls into briefs</li><li>Plan quarterly content strategies</li><li>Edit drafts from our writer network</li></ul><p>This role is based in our Toronto office.</p>',
   E'Fieldnote Media writes long-form content for B2B software companies. We need a strategist to plan editorial calendars with clients.\n\n### You will\n\n- Interview subject-matter experts and turn calls into briefs\n- Plan quarterly content strategies\n- Edit drafts from our writer network\n\nThis role is based in our Toronto office.',
   'FULL_TIME', 'onsite', 'Toronto', 'ON', 'CA', NULL, NULL, NULL, NULL, NULL,
   'onsite', NULL, 'published', 3, false, 63),
  ('lumen-labs', 'marketing', 'Growth Marketing Manager', 'growth-marketing-manager-lumen',
   '<p>Lumen Labs is hiring its first growth marketer to own acquisition for our self-serve plan.</p><h3>Responsibilities</h3><ul><li>Run paid search and lifecycle email experiments</li><li>Own the signup funnel metrics</li><li>Work with sales on the hand-off for larger clinics</li></ul><p>Hybrid: three days a week in our Austin office.</p>',
   E'Lumen Labs is hiring its first growth marketer to own acquisition for our self-serve plan.\n\n### Responsibilities\n\n- Run paid search and lifecycle email experiments\n- Own the signup funnel metrics\n- Work with sales on the hand-off for larger clinics\n\nHybrid: three days a week in our Austin office.',
   'FULL_TIME', 'hybrid', 'Austin', 'TX', 'US', NULL, 9500000, 11500000, 'USD', 'YEAR',
   'onsite', NULL, 'published', 7, false, 58),
  ('northwind-studio', 'operations', 'Operations Coordinator', 'operations-coordinator-northwind',
   '<p>Keep our studio running smoothly: scheduling, invoicing, supplier contracts and the occasional team offsite.</p><h3>What helps</h3><ul><li>Experience in a small agency or studio</li><li>Comfort with spreadsheets and accounting tools</li><li>Fluent English; German is a plus</li></ul><p>Part-time, 20 hours per week, in our Berlin studio.</p>',
   E'Keep our studio running smoothly: scheduling, invoicing, supplier contracts and the occasional team offsite.\n\n### What helps\n\n- Experience in a small agency or studio\n- Comfort with spreadsheets and accounting tools\n- Fluent English; German is a plus\n\nPart-time, 20 hours per week, in our Berlin studio.',
   'PART_TIME', 'onsite', 'Berlin', NULL, 'DE', NULL, 2500, 3000, 'EUR', 'HOUR',
   'onsite', NULL, 'published', 10, false, 41),
  ('fieldnote-media', 'content', 'Junior Copywriter (Internship)', 'junior-copywriter-internship-fieldnote',
   '<p>A paid six-month internship for a new copywriter who wants to learn B2B writing from experienced editors.</p><h3>You will learn to</h3><ul><li>Write landing pages and product emails</li><li>Interview customers for case studies</li><li>Edit your own work ruthlessly</li></ul><p>Based in Toronto. This listing has expired.</p>',
   E'A paid six-month internship for a new copywriter who wants to learn B2B writing from experienced editors.\n\n### You will learn to\n\n- Write landing pages and product emails\n- Interview customers for case studies\n- Edit your own work ruthlessly\n\nBased in Toronto. This listing has expired.',
   'INTERN', 'onsite', 'Toronto', 'ON', 'CA', NULL, 2200, 2200, 'CAD', 'HOUR',
   'onsite', NULL, 'expired', 40, false, 120),
  ('brightpath-coaching', 'coaching', 'Career Coach', 'career-coach-brightpath',
   '<p>Help mid-career professionals plan their next move. You will run structured six-session programs and track outcomes with each client.</p><h3>Requirements</h3><ul><li>Coaching qualification or equivalent experience</li><li>Background in recruiting or HR</li><li>Two days a week in our London office</li></ul><p>This listing is waiting for review.</p>',
   E'Help mid-career professionals plan their next move. You will run structured six-session programs and track outcomes with each client.\n\n### Requirements\n\n- Coaching qualification or equivalent experience\n- Background in recruiting or HR\n- Two days a week in our London office\n\nThis listing is waiting for review.',
   'PART_TIME', 'hybrid', 'London', NULL, 'GB', NULL, NULL, NULL, NULL, NULL,
   'onsite', NULL, 'pending_review', 0, false, 0)
) AS v(company, category, title, slug, html, md, employment, workplace, city, region, country,
       countries, smin, smax, scur, speriod, method, target, status, days_ago, featured, views)
JOIN "companies" co ON co."slug" = v.company
JOIN "categories" ca ON ca."slug" = v.category
WHERE NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug" = v.slug);

INSERT INTO "tags" ("name", "updated_at")
SELECT t.name, now()
FROM (VALUES ('figma'), ('design systems'), ('ux research'), ('react'), ('typescript'), ('accessibility'),
  ('icf'), ('leadership'), ('editorial'), ('seo'), ('paid search'), ('lifecycle'), ('analytics'),
  ('admin'), ('finance'), ('copywriting'), ('careers'), ('hr')) AS t(name)
WHERE NOT EXISTS (SELECT 1 FROM "tags" x WHERE x."name" = t.name);

INSERT INTO "job_tags" ("job_id", "tag_id", "updated_at")
SELECT j."id", t."id", now()
FROM (VALUES
  ('senior-product-designer-northwind', 'figma'), ('senior-product-designer-northwind', 'design systems'),
  ('senior-product-designer-northwind', 'ux research'), ('frontend-engineer-react-lumen', 'react'),
  ('frontend-engineer-react-lumen', 'typescript'), ('frontend-engineer-react-lumen', 'accessibility'),
  ('leadership-coach-freelance-brightpath', 'icf'), ('leadership-coach-freelance-brightpath', 'leadership'),
  ('content-strategist-fieldnote', 'editorial'), ('content-strategist-fieldnote', 'seo'),
  ('growth-marketing-manager-lumen', 'paid search'), ('growth-marketing-manager-lumen', 'lifecycle'),
  ('growth-marketing-manager-lumen', 'analytics'), ('operations-coordinator-northwind', 'admin'),
  ('operations-coordinator-northwind', 'finance'), ('junior-copywriter-internship-fieldnote', 'copywriting'),
  ('career-coach-brightpath', 'careers'), ('career-coach-brightpath', 'hr')
) AS v(job, tag)
JOIN "jobs" j ON j."slug" = v.job AND j."is_seed"
JOIN "tags" t ON t."name" = v.tag
WHERE NOT EXISTS (SELECT 1 FROM "job_tags" x WHERE x."job_id" = j."id" AND x."tag_id" = t."id");

INSERT INTO "applications" ("job_id", "name", "email", "cover_note", "status", "consent_at", "consent_text", "is_seed", "created_at", "updated_at")
SELECT j."id", v.name, v.email, v.note, v.status, now() - make_interval(hours => v.hours_ago),
  'I agree that the employer may process my application and resume to consider me for this job. My resume is deleted 180 days after I apply.',
  true, now() - make_interval(hours => v.hours_ago), now()
FROM (VALUES
  ('senior-product-designer-northwind', 'Maya Lindqvist', 'maya.lindqvist@example.com', 'shortlisted', 30,
   'I led the design system at a 40-person fintech and would love to do the same for your clients.'),
  ('senior-product-designer-northwind', 'Tomás Ortega', 'tomas.ortega@example.com', 'new', 6, NULL),
  ('frontend-engineer-react-lumen', 'Priya Natarajan', 'priya.n@example.com', 'reviewed', 20,
   'Five years of React and TypeScript, most recently on a scheduling product.'),
  ('frontend-engineer-react-lumen', 'Sam Okafor', 'sam.okafor@example.com', 'new', 3, NULL),
  ('content-strategist-fieldnote', 'Lea Moreau', 'lea.moreau@example.com', 'new', 12,
   'I run the content program for two SaaS companies and write about developer tools.')
) AS v(job, name, email, status, hours_ago, note)
JOIN "jobs" j ON j."slug" = v.job AND j."is_seed"
WHERE NOT EXISTS (SELECT 1 FROM "applications" a WHERE a."job_id" = j."id" AND a."email" = v.email);

-- Dummy Basic and Featured tiers beside the migration's Standard (owner decision 2026-10-30;
-- the owner sets real values later in the admin). Each is skipped when a tier with its price key
-- exists. The Standard row is never touched (it may have been edited): Basic sorts before it
-- (-1), Featured after it (1). One insert per tier so each sees the other's row: a tier goes in
-- inactive when 3 are already active (the board's 1–3 active tiers rule).
INSERT INTO "listing_tiers" ("name", "price_key", "price_cents", "currency", "duration_days", "includes_featured", "is_active", "sort_order", "updated_at")
SELECT 'Basic', 'listing-basic-30', 4900, 'USD', 30, false,
  (SELECT count(*) FROM "listing_tiers" WHERE "is_active") < 3, -1, now()
WHERE NOT EXISTS (SELECT 1 FROM "listing_tiers" WHERE "price_key" = 'listing-basic-30');

INSERT INTO "listing_tiers" ("name", "price_key", "price_cents", "currency", "duration_days", "includes_featured", "is_active", "sort_order", "updated_at")
SELECT 'Featured', 'listing-featured-30', 19900, 'USD', 30, true,
  (SELECT count(*) FROM "listing_tiers" WHERE "is_active") < 3, 1, now()
WHERE NOT EXISTS (SELECT 1 FROM "listing_tiers" WHERE "price_key" = 'listing-featured-30');

-- Counters kept on write elsewhere: recomputed here for the seed rows only.
UPDATE "jobs" j SET "application_count" = (SELECT count(*)::int FROM "applications" a WHERE a."job_id" = j."id")
WHERE j."is_seed";
UPDATE "companies" c SET "active_job_count" = (
  SELECT count(*)::int FROM "jobs" j WHERE j."company_id" = c."id" AND j."status" = 'published' AND j."expires_at" > now()
) WHERE c."is_seed";

COMMIT;
