-- Demo data for the LOCAL / Preview database: makes the board look like a live site.
-- Run: npx prisma db execute --file prisma/seed-demo.sql   (after `npx prisma db seed`).
-- Idempotent (skips rows that exist). Every board row has is_seed = true. Dates are relative to
-- now(). Fake people use example.com; the two demo accounts use @talenttrail.test.
--   admin@talenttrail.test     role admin    (the real owner account is made by the platform)
--   employer@talenttrail.test  role member, owns the company "Harbor & Pine"
--   Both password: Talent#Trail2026
BEGIN;

INSERT INTO "users" ("email","password_hash","name","status","email_verified_at","last_login_at","updated_at")
VALUES ('admin@talenttrail.test', 'pbkdf2-sha256$v1$600000$tOFH0WiyTkRMMd4qiKx8pw$6cJvYj1RJEJQNH-fRDZiuIzqNefNws1TT9buVEIKplk', 'Board Admin', 'active', now() - interval '40 days', now() - interval '0 days', now())
ON CONFLICT ("email") DO NOTHING;
INSERT INTO "user_roles" ("user_id","role_id")
SELECT u."id", r."id" FROM "users" u, "roles" r WHERE u."email" = 'admin@talenttrail.test' AND r."slug" = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO "users" ("email","password_hash","name","status","email_verified_at","last_login_at","updated_at")
VALUES ('employer@talenttrail.test', 'pbkdf2-sha256$v1$600000$tOFH0WiyTkRMMd4qiKx8pw$6cJvYj1RJEJQNH-fRDZiuIzqNefNws1TT9buVEIKplk', 'Elena Fischer', 'active', now() - interval '40 days', now() - interval '1 days', now())
ON CONFLICT ("email") DO NOTHING;
INSERT INTO "user_roles" ("user_id","role_id")
SELECT u."id", r."id" FROM "users" u, "roles" r WHERE u."email" = 'employer@talenttrail.test' AND r."slug" = 'member'
ON CONFLICT DO NOTHING;

INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Harbor & Pine','harbor-pine','https://harborpine.example','Portland, USA','<p>Harbor &amp; Pine is a design-led outdoor gear brand. We make packs and apparel built to last and ship worldwide.</p>','employer',(SELECT "id" FROM "users" WHERE "email"='employer@talenttrail.test'),true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='harbor-pine');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Orbit Health','orbit-health','https://orbithealth.example','Boston, USA','<p>Orbit Health helps hospitals follow up with patients after discharge using simple text-message programs.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='orbit-health');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Kestrel Logistics','kestrel-logistics','https://kestrel.example','Rotterdam, Netherlands','<p>Kestrel runs cross-border freight software for 600 European carriers.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='kestrel-logistics');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Verdant Foods','verdant-foods','https://verdantfoods.example','Sydney, Australia','<p>Verdant Foods grows and delivers organic produce to 40,000 households.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='verdant-foods');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Quillstack','quillstack','https://quillstack.example','Remote, Worldwide','<p>Quillstack is a fully remote documentation platform for engineering teams.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='quillstack');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Meridian Bank','meridian-bank','https://meridianbank.example','Dublin, Ireland','<p>Meridian is a digital bank for freelancers and small studios.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='meridian-bank');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Pixel Forge Games','pixel-forge','https://pixelforge.example','Montréal, Canada','<p>An independent studio making cozy strategy games for PC and console.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='pixel-forge');
INSERT INTO "companies" ("name","slug","website","location","about_html","source","owner_user_id","is_trusted","is_seed","updated_at")
SELECT 'Cedar & Co. Learning','cedar-co','https://cedarlearning.example','Chicago, USA','<p>Cedar builds online courses for community colleges and vocational schools.</p>','admin',NULL,true,true,now()
WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."slug"='cedar-co');

INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Brand Designer','brand-designer-harbor-pine','<p>We are looking for a Brand Designer to join Harbor & Pine and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Brand Designer to join Harbor & Pine and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Portland','OR','US',NULL::jsonb,8500000,10500000,'USD','YEAR','onsite','published',NULL,'paid',true,now() + interval '26 days',now() - interval '4 days',now() + interval '26 days',30,true,152,27,false,true,now(),now() - interval '5 days'
FROM "companies" co, "categories" ca WHERE co."slug"='harbor-pine' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='brand-designer-harbor-pine');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'E-commerce Marketing Manager','e-commerce-marketing-manager-harbor-pine','<p>We are looking for a E-commerce Marketing Manager to join Harbor & Pine and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a E-commerce Marketing Manager to join Harbor & Pine and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["US","CA"]'::jsonb,9000000,11000000,'USD','YEAR','onsite','published',NULL,'paid',false,NULL,now() - interval '9 days',now() + interval '21 days',30,false,96,17,false,true,now(),now() - interval '10 days'
FROM "companies" co, "categories" ca WHERE co."slug"='harbor-pine' AND ca."slug"='marketing'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='e-commerce-marketing-manager-harbor-pine');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Warehouse Operations Lead','warehouse-operations-lead-harbor-pine','<p>We are looking for a Warehouse Operations Lead to join Harbor & Pine and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Warehouse Operations Lead to join Harbor & Pine and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','onsite','Portland','OR','US',NULL::jsonb,6800000,7800000,'USD','YEAR','onsite','published',NULL,'paid',false,NULL,now() - interval '15 days',now() + interval '15 days',30,false,64,11,false,true,now(),now() - interval '16 days'
FROM "companies" co, "categories" ca WHERE co."slug"='harbor-pine' AND ca."slug"='operations'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='warehouse-operations-lead-harbor-pine');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Product Copywriter','product-copywriter-harbor-pine','<p>We are looking for a Product Copywriter to join Harbor & Pine and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Product Copywriter to join Harbor & Pine and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','PART_TIME','remote',NULL,NULL,NULL,'["US"]'::jsonb,4500,5500,'USD','HOUR','onsite','pending_review',NULL,'paid',false,NULL,NULL,NULL,30,false,0,0,true,true,now(),now() - interval '1 days'
FROM "companies" co, "categories" ca WHERE co."slug"='harbor-pine' AND ca."slug"='content'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='product-copywriter-harbor-pine');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Shopify Developer','shopify-developer-harbor-pine','<p>We are looking for a Shopify Developer to join Harbor & Pine and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Shopify Developer to join Harbor & Pine and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','CONTRACTOR','remote',NULL,NULL,NULL,NULL::jsonb,7000,9500,'USD','HOUR','onsite','draft',NULL,'paid',false,NULL,NULL,NULL,30,false,0,0,false,true,now(),now() - interval '1 days'
FROM "companies" co, "categories" ca WHERE co."slug"='harbor-pine' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='shopify-developer-harbor-pine');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Packaging Designer (Intern)','packaging-designer-intern-harbor-pine','<p>We are looking for a Packaging Designer (Intern) to join Harbor & Pine and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Packaging Designer (Intern) to join Harbor & Pine and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','INTERN','onsite','Portland','OR','US',NULL::jsonb,2400,2400,'USD','HOUR','onsite','expired',NULL,'paid',false,NULL,now() - interval '42 days',now() - interval '12 days',30,false,210,37,false,true,now(),now() - interval '43 days'
FROM "companies" co, "categories" ca WHERE co."slug"='harbor-pine' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='packaging-designer-intern-harbor-pine');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Backend Engineer (Go)','backend-engineer-go-orbit-health','<p>We are looking for a Backend Engineer (Go) to join Orbit Health and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Backend Engineer (Go) to join Orbit Health and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["US","CA"]'::jsonb,13000000,16500000,'USD','YEAR','onsite','published',NULL,'admin',true,now() + interval '28 days',now() - interval '2 days',now() + interval '28 days',30,true,318,57,false,true,now(),now() - interval '3 days'
FROM "companies" co, "categories" ca WHERE co."slug"='orbit-health' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='backend-engineer-go-orbit-health');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Product Designer, Patient Experience','product-designer-patient-experience-orbit-health','<p>We are looking for a Product Designer, Patient Experience to join Orbit Health and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Product Designer, Patient Experience to join Orbit Health and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Boston','MA','US',NULL::jsonb,11000000,13500000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '6 days',now() + interval '24 days',30,false,142,25,false,true,now(),now() - interval '7 days'
FROM "companies" co, "categories" ca WHERE co."slug"='orbit-health' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='product-designer-patient-experience-orbit-health');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Clinical Operations Specialist','clinical-operations-specialist-orbit-health','<p>We are looking for a Clinical Operations Specialist to join Orbit Health and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Clinical Operations Specialist to join Orbit Health and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','onsite','Boston','MA','US',NULL::jsonb,7200000,8600000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '11 days',now() + interval '19 days',30,false,77,13,false,true,now(),now() - interval '12 days'
FROM "companies" co, "categories" ca WHERE co."slug"='orbit-health' AND ca."slug"='operations'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='clinical-operations-specialist-orbit-health');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Content Marketing Lead','content-marketing-lead-orbit-health','<p>We are looking for a Content Marketing Lead to join Orbit Health and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Content Marketing Lead to join Orbit Health and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["US"]'::jsonb,9800000,12000000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '18 days',now() + interval '12 days',30,false,88,15,false,true,now(),now() - interval '19 days'
FROM "companies" co, "categories" ca WHERE co."slug"='orbit-health' AND ca."slug"='marketing'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='content-marketing-lead-orbit-health');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Senior Full-Stack Engineer','senior-full-stack-engineer-kestrel-logistics','<p>We are looking for a Senior Full-Stack Engineer to join Kestrel Logistics and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Senior Full-Stack Engineer to join Kestrel Logistics and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Rotterdam',NULL,'NL',NULL::jsonb,7500000,9500000,'EUR','YEAR','onsite','published',NULL,'admin',true,now() + interval '27 days',now() - interval '3 days',now() + interval '27 days',30,true,201,36,false,true,now(),now() - interval '4 days'
FROM "companies" co, "categories" ca WHERE co."slug"='kestrel-logistics' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='senior-full-stack-engineer-kestrel-logistics');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'DevOps Engineer','devops-engineer-kestrel-logistics','<p>We are looking for a DevOps Engineer to join Kestrel Logistics and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a DevOps Engineer to join Kestrel Logistics and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["NL","DE","BE"]'::jsonb,7000000,9000000,'EUR','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '8 days',now() + interval '22 days',30,false,133,23,false,true,now(),now() - interval '9 days'
FROM "companies" co, "categories" ca WHERE co."slug"='kestrel-logistics' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='devops-engineer-kestrel-logistics');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Customer Success Manager','customer-success-manager-kestrel-logistics','<p>We are looking for a Customer Success Manager to join Kestrel Logistics and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Customer Success Manager to join Kestrel Logistics and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Rotterdam',NULL,'NL',NULL::jsonb,5200000,6400000,'EUR','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '13 days',now() + interval '17 days',30,false,59,10,false,true,now(),now() - interval '14 days'
FROM "companies" co, "categories" ca WHERE co."slug"='kestrel-logistics' AND ca."slug"='operations'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='customer-success-manager-kestrel-logistics');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Demand Generation Specialist','demand-generation-specialist-kestrel-logistics','<p>We are looking for a Demand Generation Specialist to join Kestrel Logistics and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Demand Generation Specialist to join Kestrel Logistics and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','PART_TIME','remote',NULL,NULL,NULL,'["NL","DE"]'::jsonb,3200,4200,'EUR','HOUR','onsite','published',NULL,'admin',false,NULL,now() - interval '20 days',now() + interval '10 days',30,false,45,8,false,true,now(),now() - interval '21 days'
FROM "companies" co, "categories" ca WHERE co."slug"='kestrel-logistics' AND ca."slug"='marketing'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='demand-generation-specialist-kestrel-logistics');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Supply Chain Planner','supply-chain-planner-verdant-foods','<p>We are looking for a Supply Chain Planner to join Verdant Foods and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Supply Chain Planner to join Verdant Foods and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','onsite','Sydney','NSW','AU',NULL::jsonb,9500000,11500000,'AUD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '5 days',now() + interval '25 days',30,false,91,16,false,true,now(),now() - interval '6 days'
FROM "companies" co, "categories" ca WHERE co."slug"='verdant-foods' AND ca."slug"='operations'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='supply-chain-planner-verdant-foods');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Brand Marketing Manager','brand-marketing-manager-verdant-foods','<p>We are looking for a Brand Marketing Manager to join Verdant Foods and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Brand Marketing Manager to join Verdant Foods and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Sydney','NSW','AU',NULL::jsonb,10500000,13000000,'AUD','YEAR','onsite','published',NULL,'admin',true,now() + interval '20 days',now() - interval '10 days',now() + interval '20 days',30,true,167,30,false,true,now(),now() - interval '11 days'
FROM "companies" co, "categories" ca WHERE co."slug"='verdant-foods' AND ca."slug"='marketing'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='brand-marketing-manager-verdant-foods');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Recipe Content Editor','recipe-content-editor-verdant-foods','<p>We are looking for a Recipe Content Editor to join Verdant Foods and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Recipe Content Editor to join Verdant Foods and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','PART_TIME','remote',NULL,NULL,NULL,'["AU","NZ"]'::jsonb,3800,4600,'AUD','HOUR','onsite','published',NULL,'admin',false,NULL,now() - interval '16 days',now() + interval '14 days',30,false,52,9,false,true,now(),now() - interval '17 days'
FROM "companies" co, "categories" ca WHERE co."slug"='verdant-foods' AND ca."slug"='content'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='recipe-content-editor-verdant-foods');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Packaging Designer','packaging-designer-verdant-foods','<p>We are looking for a Packaging Designer to join Verdant Foods and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Packaging Designer to join Verdant Foods and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','CONTRACTOR','onsite','Sydney','NSW','AU',NULL::jsonb,6500,8500,'AUD','HOUR','onsite','expired',NULL,'admin',false,NULL,now() - interval '38 days',now() - interval '8 days',30,false,174,31,false,true,now(),now() - interval '39 days'
FROM "companies" co, "categories" ca WHERE co."slug"='verdant-foods' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='packaging-designer-verdant-foods');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Staff Engineer, Developer Platform','staff-engineer-developer-platform-quillstack','<p>We are looking for a Staff Engineer, Developer Platform to join Quillstack and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Staff Engineer, Developer Platform to join Quillstack and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,NULL::jsonb,18000000,22000000,'USD','YEAR','onsite','published',NULL,'admin',true,now() + interval '29 days',now() - interval '1 days',now() + interval '29 days',30,true,402,72,false,true,now(),now() - interval '2 days'
FROM "companies" co, "categories" ca WHERE co."slug"='quillstack' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='staff-engineer-developer-platform-quillstack');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Technical Writer','technical-writer-quillstack','<p>We are looking for a Technical Writer to join Quillstack and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Technical Writer to join Quillstack and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,NULL::jsonb,9000000,11500000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '7 days',now() + interval '23 days',30,false,189,34,false,true,now(),now() - interval '8 days'
FROM "companies" co, "categories" ca WHERE co."slug"='quillstack' AND ca."slug"='content'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='technical-writer-quillstack');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Engineering Manager Coach','engineering-manager-coach-quillstack','<p>We are looking for a Engineering Manager Coach to join Quillstack and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Engineering Manager Coach to join Quillstack and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','CONTRACTOR','remote',NULL,NULL,NULL,NULL::jsonb,9000,13000,'USD','HOUR','onsite','published',NULL,'admin',false,NULL,now() - interval '12 days',now() + interval '18 days',30,false,70,12,false,true,now(),now() - interval '13 days'
FROM "companies" co, "categories" ca WHERE co."slug"='quillstack' AND ca."slug"='coaching'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='engineering-manager-coach-quillstack');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Design Systems Designer','design-systems-designer-quillstack','<p>We are looking for a Design Systems Designer to join Quillstack and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Design Systems Designer to join Quillstack and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,NULL::jsonb,12500000,15500000,'USD','YEAR','onsite','pending_review',NULL,'admin',false,NULL,NULL,NULL,30,false,0,0,false,true,now(),now() - interval '1 days'
FROM "companies" co, "categories" ca WHERE co."slug"='quillstack' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='design-systems-designer-quillstack');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Senior Backend Engineer (Payments)','senior-backend-engineer-payments-meridian-bank','<p>We are looking for a Senior Backend Engineer (Payments) to join Meridian Bank and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Senior Backend Engineer (Payments) to join Meridian Bank and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Dublin',NULL,'IE',NULL::jsonb,8500000,10500000,'EUR','YEAR','onsite','published',NULL,'admin',true,now() + interval '28 days',now() - interval '2 days',now() + interval '28 days',30,true,266,47,false,true,now(),now() - interval '3 days'
FROM "companies" co, "categories" ca WHERE co."slug"='meridian-bank' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='senior-backend-engineer-payments-meridian-bank');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Compliance Analyst','compliance-analyst-meridian-bank','<p>We are looking for a Compliance Analyst to join Meridian Bank and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Compliance Analyst to join Meridian Bank and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','onsite','Dublin',NULL,'IE',NULL::jsonb,6000000,7400000,'EUR','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '9 days',now() + interval '21 days',30,false,83,14,false,true,now(),now() - interval '10 days'
FROM "companies" co, "categories" ca WHERE co."slug"='meridian-bank' AND ca."slug"='operations'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='compliance-analyst-meridian-bank');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Lifecycle Marketing Manager','lifecycle-marketing-manager-meridian-bank','<p>We are looking for a Lifecycle Marketing Manager to join Meridian Bank and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Lifecycle Marketing Manager to join Meridian Bank and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Dublin',NULL,'IE',NULL::jsonb,7200000,8800000,'EUR','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '14 days',now() + interval '16 days',30,false,72,12,false,true,now(),now() - interval '15 days'
FROM "companies" co, "categories" ca WHERE co."slug"='meridian-bank' AND ca."slug"='marketing'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='lifecycle-marketing-manager-meridian-bank');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'UX Researcher','ux-researcher-meridian-bank','<p>We are looking for a UX Researcher to join Meridian Bank and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a UX Researcher to join Meridian Bank and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','CONTRACTOR','remote',NULL,NULL,NULL,'["IE","GB"]'::jsonb,6000,8000,'EUR','HOUR','onsite','rejected','Please add a salary range and a clearer description of the role.','admin',false,NULL,now() - interval '0 days',NULL,30,false,0,0,false,true,now(),now() - interval '1 days'
FROM "companies" co, "categories" ca WHERE co."slug"='meridian-bank' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='ux-researcher-meridian-bank');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Gameplay Programmer (C++)','gameplay-programmer-c-pixel-forge','<p>We are looking for a Gameplay Programmer (C++) to join Pixel Forge Games and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Gameplay Programmer (C++) to join Pixel Forge Games and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Montréal','QC','CA',NULL::jsonb,9500000,12500000,'CAD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '4 days',now() + interval '26 days',30,false,158,28,false,true,now(),now() - interval '5 days'
FROM "companies" co, "categories" ca WHERE co."slug"='pixel-forge' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='gameplay-programmer-c-pixel-forge');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Game Artist, 2D/UI','game-artist-2d-ui-pixel-forge','<p>We are looking for a Game Artist, 2D/UI to join Pixel Forge Games and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Game Artist, 2D/UI to join Pixel Forge Games and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["CA","US"]'::jsonb,7500000,9500000,'CAD','YEAR','onsite','published',NULL,'admin',true,now() + interval '22 days',now() - interval '8 days',now() + interval '22 days',30,true,223,40,false,true,now(),now() - interval '9 days'
FROM "companies" co, "categories" ca WHERE co."slug"='pixel-forge' AND ca."slug"='design'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='game-artist-2d-ui-pixel-forge');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Narrative Designer','narrative-designer-pixel-forge','<p>We are looking for a Narrative Designer to join Pixel Forge Games and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Narrative Designer to join Pixel Forge Games and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','PART_TIME','remote',NULL,NULL,NULL,NULL::jsonb,4500,6000,'CAD','HOUR','onsite','published',NULL,'admin',false,NULL,now() - interval '17 days',now() + interval '13 days',30,false,61,10,false,true,now(),now() - interval '18 days'
FROM "companies" co, "categories" ca WHERE co."slug"='pixel-forge' AND ca."slug"='content'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='narrative-designer-pixel-forge');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Learning Experience Coach','learning-experience-coach-cedar-co','<p>We are looking for a Learning Experience Coach to join Cedar & Co. Learning and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Learning Experience Coach to join Cedar & Co. Learning and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','hybrid','Chicago','IL','US',NULL::jsonb,7500000,9000000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '5 days',now() + interval '25 days',30,false,74,13,false,true,now(),now() - interval '6 days'
FROM "companies" co, "categories" ca WHERE co."slug"='cedar-co' AND ca."slug"='coaching'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='learning-experience-coach-cedar-co');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Instructional Designer','instructional-designer-cedar-co','<p>We are looking for a Instructional Designer to join Cedar & Co. Learning and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Instructional Designer to join Cedar & Co. Learning and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["US"]'::jsonb,7800000,9600000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '11 days',now() + interval '19 days',30,false,98,17,false,true,now(),now() - interval '12 days'
FROM "companies" co, "categories" ca WHERE co."slug"='cedar-co' AND ca."slug"='content'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='instructional-designer-cedar-co');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Frontend Engineer (Education)','frontend-engineer-education-cedar-co','<p>We are looking for a Frontend Engineer (Education) to join Cedar & Co. Learning and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Frontend Engineer (Education) to join Cedar & Co. Learning and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','FULL_TIME','remote',NULL,NULL,NULL,'["US","CA"]'::jsonb,11000000,14000000,'USD','YEAR','onsite','published',NULL,'admin',false,NULL,now() - interval '19 days',now() + interval '11 days',30,false,115,20,false,true,now(),now() - interval '20 days'
FROM "companies" co, "categories" ca WHERE co."slug"='cedar-co' AND ca."slug"='engineering'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='frontend-engineer-education-cedar-co');
INSERT INTO "jobs" ("company_id","category_id","title","slug","description_html","description_md","employment_type","workplace_type","location_city","location_region","location_country","applicant_countries","salary_min_cents","salary_max_cents","salary_currency","salary_period","apply_method","status","rejection_reason","source","is_featured","featured_until","published_at","expires_at","duration_days","listing_featured","view_count","apply_click_count","needs_review","is_seed","updated_at","created_at")
SELECT co."id",ca."id",'Partnerships Coordinator','partnerships-coordinator-cedar-co','<p>We are looking for a Partnerships Coordinator to join Cedar & Co. Learning and help us ship work our customers notice.</p><h3>What you will do</h3><ul><li>Own your area end to end, from the first idea to what customers see</li><li>Share what you learn in short written updates</li><li>Work with people across the team and with customers</li><li>Improve how we work, not just what we make</li></ul><h3>About you</h3><p>You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.</p>','We are looking for a Partnerships Coordinator to join Cedar & Co. Learning and help us ship work our customers notice.

### What you will do

- Own your area end to end, from the first idea to what customers see
- Share what you learn in short written updates
- Work with people across the team and with customers
- Improve how we work, not just what we make

### About you

You will work closely with a small, friendly team that values clear writing, steady pace and honest feedback.','TEMPORARY','onsite','Chicago','IL','US',NULL::jsonb,3000,3600,'USD','HOUR','onsite','closed',NULL,'admin',false,NULL,now() - interval '25 days',now() + interval '5 days',30,false,66,11,false,true,now(),now() - interval '26 days'
FROM "companies" co, "categories" ca WHERE co."slug"='cedar-co' AND ca."slug"='operations'
AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."slug"='partnerships-coordinator-cedar-co');

INSERT INTO "tags" ("name","updated_at") SELECT t.name, now() FROM (VALUES ('accessibility'),('admin'),('analytics'),('aws'),('branding'),('c++'),('careers'),('copywriting'),('customer success'),('design systems'),('editorial'),('figma'),('finance'),('go'),('healthcare'),('icf'),('java'),('kubernetes'),('leadership'),('lifecycle'),('logistics'),('paid search'),('postgres'),('react'),('saas'),('seo'),('typescript'),('unity'),('ux research')) AS t(name) WHERE NOT EXISTS (SELECT 1 FROM "tags" x WHERE x."name"=t.name);
INSERT INTO "job_tags" ("job_id","tag_id","updated_at") SELECT j."id",t."id",now() FROM (VALUES ('brand-designer-harbor-pine','branding'),('brand-designer-harbor-pine','figma'),('e-commerce-marketing-manager-harbor-pine','seo'),('e-commerce-marketing-manager-harbor-pine','lifecycle'),('e-commerce-marketing-manager-harbor-pine','analytics'),('warehouse-operations-lead-harbor-pine','logistics'),('warehouse-operations-lead-harbor-pine','admin'),('product-copywriter-harbor-pine','copywriting'),('shopify-developer-harbor-pine','react'),('shopify-developer-harbor-pine','typescript'),('packaging-designer-intern-harbor-pine','figma'),('backend-engineer-go-orbit-health','go'),('backend-engineer-go-orbit-health','postgres'),('product-designer-patient-experience-orbit-health','figma'),('product-designer-patient-experience-orbit-health','ux research'),('product-designer-patient-experience-orbit-health','accessibility'),('clinical-operations-specialist-orbit-health','healthcare'),('clinical-operations-specialist-orbit-health','admin'),('content-marketing-lead-orbit-health','editorial'),('content-marketing-lead-orbit-health','seo'),('senior-full-stack-engineer-kestrel-logistics','react'),('senior-full-stack-engineer-kestrel-logistics','typescript'),('senior-full-stack-engineer-kestrel-logistics','postgres'),('devops-engineer-kestrel-logistics','kubernetes'),('devops-engineer-kestrel-logistics','aws'),('customer-success-manager-kestrel-logistics','saas'),('customer-success-manager-kestrel-logistics','customer success'),('demand-generation-specialist-kestrel-logistics','paid search'),('demand-generation-specialist-kestrel-logistics','analytics'),('supply-chain-planner-verdant-foods','logistics'),('supply-chain-planner-verdant-foods','finance'),('brand-marketing-manager-verdant-foods','branding'),('brand-marketing-manager-verdant-foods','lifecycle'),('recipe-content-editor-verdant-foods','editorial'),('recipe-content-editor-verdant-foods','copywriting'),('packaging-designer-verdant-foods','figma'),('packaging-designer-verdant-foods','branding'),('staff-engineer-developer-platform-quillstack','typescript'),('staff-engineer-developer-platform-quillstack','postgres'),('staff-engineer-developer-platform-quillstack','accessibility'),('technical-writer-quillstack','editorial'),('technical-writer-quillstack','accessibility'),('engineering-manager-coach-quillstack','leadership'),('engineering-manager-coach-quillstack','icf'),('design-systems-designer-quillstack','figma'),('design-systems-designer-quillstack','design systems'),('senior-backend-engineer-payments-meridian-bank','java'),('senior-backend-engineer-payments-meridian-bank','postgres'),('compliance-analyst-meridian-bank','finance'),('compliance-analyst-meridian-bank','analytics'),('lifecycle-marketing-manager-meridian-bank','lifecycle'),('lifecycle-marketing-manager-meridian-bank','analytics'),('ux-researcher-meridian-bank','ux research'),('gameplay-programmer-c-pixel-forge','c++'),('gameplay-programmer-c-pixel-forge','unity'),('game-artist-2d-ui-pixel-forge','figma'),('game-artist-2d-ui-pixel-forge','branding'),('narrative-designer-pixel-forge','editorial'),('narrative-designer-pixel-forge','copywriting'),('learning-experience-coach-cedar-co','leadership'),('learning-experience-coach-cedar-co','careers'),('instructional-designer-cedar-co','editorial'),('instructional-designer-cedar-co','accessibility'),('frontend-engineer-education-cedar-co','react'),('frontend-engineer-education-cedar-co','typescript'),('frontend-engineer-education-cedar-co','accessibility'),('partnerships-coordinator-cedar-co','admin')) AS v(job,tag) JOIN "jobs" j ON j."slug"=v.job JOIN "tags" t ON t."name"=v.tag WHERE NOT EXISTS (SELECT 1 FROM "job_tags" x WHERE x."job_id"=j."id" AND x."tag_id"=t."id");

INSERT INTO "applications" ("job_id","name","email","cover_note","status","consent_at","consent_text","is_seed","created_at","updated_at")
SELECT j."id",v.name,v.email,v.note,v.status,now() - make_interval(hours => v.h),'I agree that the employer may process my application and resume to consider me for this job. My resume is deleted 180 days after I apply.',true,now() - make_interval(hours => v.h),now()
FROM (VALUES ('brand-designer-harbor-pine','Emma Chen','emma.chen@example.com','shortlisted',8,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('brand-designer-harbor-pine','Rosa Alvarez','rosa.alvarez@example.com','new',76,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('brand-designer-harbor-pine','Quinn Kim','quinn.kim@example.com','new',13,NULL),('brand-designer-harbor-pine','Noah Rossi','noah.rossi@example.com','new',13,'I am based nearby and can start within a month.'),('brand-designer-harbor-pine','Noah Walker','noah.walker@example.com','rejected',74,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('e-commerce-marketing-manager-harbor-pine','Uma Rao','uma.rao@example.com','reviewed',17,'I am based nearby and can start within a month.'),('e-commerce-marketing-manager-harbor-pine','Sven Chen','sven.chen@example.com','new',58,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('e-commerce-marketing-manager-harbor-pine','Rosa Novak','rosa.novak@example.com','new',109,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('e-commerce-marketing-manager-harbor-pine','Rosa Alvarez','rosa.alvarez@example.com','reviewed',80,'I am based nearby and can start within a month.'),('warehouse-operations-lead-harbor-pine','Victor Haddad','victor.haddad@example.com','new',299,'I am based nearby and can start within a month.'),('warehouse-operations-lead-harbor-pine','Uma Kim','uma.kim@example.com','new',51,'I am based nearby and can start within a month.'),('warehouse-operations-lead-harbor-pine','Wen Rossi','wen.rossi@example.com','reviewed',32,'I am based nearby and can start within a month.'),('warehouse-operations-lead-harbor-pine','Grace Silva','grace.silva@example.com','shortlisted',274,NULL),('warehouse-operations-lead-harbor-pine','Zane Iyer','zane.iyer@example.com','reviewed',301,NULL),('warehouse-operations-lead-harbor-pine','Liam Berg','liam.berg@example.com','new',94,'Excited about this: it matches what I want to do next.'),('warehouse-operations-lead-harbor-pine','Zane Tanaka','zane.tanaka@example.com','new',296,NULL),('warehouse-operations-lead-harbor-pine','Quinn Silva','quinn.silva@example.com','new',231,NULL),('warehouse-operations-lead-harbor-pine','Tara Rossi','tara.rossi@example.com','new',264,NULL),('packaging-designer-intern-harbor-pine','Zane Iyer','zane.iyer@example.com','new',957,NULL),('packaging-designer-intern-harbor-pine','Noah Walker','noah.walker@example.com','shortlisted',81,'I am based nearby and can start within a month.'),('packaging-designer-intern-harbor-pine','Sven Iyer','sven.iyer@example.com','new',713,NULL),('packaging-designer-intern-harbor-pine','Tara Silva','tara.silva@example.com','reviewed',818,NULL),('product-designer-patient-experience-orbit-health','Carla Costa','carla.costa@example.com','reviewed',18,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('product-designer-patient-experience-orbit-health','Yara Zhao','yara.zhao@example.com','new',116,NULL),('product-designer-patient-experience-orbit-health','Wen Chen','wen.chen@example.com','shortlisted',90,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('product-designer-patient-experience-orbit-health','Olga Murphy','olga.murphy@example.com','new',31,NULL),('product-designer-patient-experience-orbit-health','Ben Kim','ben.kim@example.com','rejected',75,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('product-designer-patient-experience-orbit-health','Yara Tanaka','yara.tanaka@example.com','reviewed',102,NULL),('content-marketing-lead-orbit-health','Olga Chen','olga.chen@example.com','reviewed',144,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('senior-full-stack-engineer-kestrel-logistics','Noah Mendes','noah.mendes@example.com','new',55,NULL),('senior-full-stack-engineer-kestrel-logistics','Victor Chen','victor.chen@example.com','new',21,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('senior-full-stack-engineer-kestrel-logistics','Farid Novak','farid.novak@example.com','new',31,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('senior-full-stack-engineer-kestrel-logistics','Pablo Larsen','pablo.larsen@example.com','new',35,NULL),('senior-full-stack-engineer-kestrel-logistics','Aisha Novak','aisha.novak@example.com','reviewed',70,NULL),('senior-full-stack-engineer-kestrel-logistics','Tara Larsen','tara.larsen@example.com','new',18,'Excited about this: it matches what I want to do next.'),('devops-engineer-kestrel-logistics','Quinn Singh','quinn.singh@example.com','shortlisted',175,'Excited about this: it matches what I want to do next.'),('devops-engineer-kestrel-logistics','Ben Petrova','ben.petrova@example.com','rejected',176,'I am based nearby and can start within a month.'),('devops-engineer-kestrel-logistics','Mei Chen','mei.chen@example.com','reviewed',102,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('devops-engineer-kestrel-logistics','Pablo Rao','pablo.rao@example.com','reviewed',17,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('devops-engineer-kestrel-logistics','Carla Kim','carla.kim@example.com','reviewed',43,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('devops-engineer-kestrel-logistics','Kavya Singh','kavya.singh@example.com','new',28,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('customer-success-manager-kestrel-logistics','Emma Mendes','emma.mendes@example.com','new',188,'I am based nearby and can start within a month.'),('customer-success-manager-kestrel-logistics','Aisha Rossi','aisha.rossi@example.com','rejected',108,'I am based nearby and can start within a month.'),('customer-success-manager-kestrel-logistics','Mei Novak','mei.novak@example.com','shortlisted',131,NULL),('customer-success-manager-kestrel-logistics','Tara Murphy','tara.murphy@example.com','reviewed',64,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('demand-generation-specialist-kestrel-logistics','Pablo Petrova','pablo.petrova@example.com','reviewed',249,NULL),('demand-generation-specialist-kestrel-logistics','Carla Novak','carla.novak@example.com','new',385,NULL),('demand-generation-specialist-kestrel-logistics','Yara Costa','yara.costa@example.com','reviewed',426,'Excited about this: it matches what I want to do next.'),('demand-generation-specialist-kestrel-logistics','Farid Reed','farid.reed@example.com','new',107,'I am based nearby and can start within a month.'),('demand-generation-specialist-kestrel-logistics','Liam Novak','liam.novak@example.com','shortlisted',280,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('demand-generation-specialist-kestrel-logistics','Zane Reed','zane.reed@example.com','new',331,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('supply-chain-planner-verdant-foods','Ines Reed','ines.reed@example.com','new',118,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('supply-chain-planner-verdant-foods','Liam Hart','liam.hart@example.com','new',70,'I am based nearby and can start within a month.'),('supply-chain-planner-verdant-foods','Zane Reed','zane.reed@example.com','new',83,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('supply-chain-planner-verdant-foods','Tara Hart','tara.hart@example.com','rejected',26,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('supply-chain-planner-verdant-foods','Mei Aziz','mei.aziz@example.com','rejected',31,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('brand-marketing-manager-verdant-foods','Pablo Murphy','pablo.murphy@example.com','shortlisted',9,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('brand-marketing-manager-verdant-foods','Ines Silva','ines.silva@example.com','new',51,'Excited about this: it matches what I want to do next.'),('brand-marketing-manager-verdant-foods','Tara Murphy','tara.murphy@example.com','reviewed',208,'Excited about this: it matches what I want to do next.'),('brand-marketing-manager-verdant-foods','Liam Murphy','liam.murphy@example.com','new',58,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('recipe-content-editor-verdant-foods','Pablo Kim','pablo.kim@example.com','new',106,NULL),('packaging-designer-verdant-foods','Tara Khan','tara.khan@example.com','reviewed',670,NULL),('packaging-designer-verdant-foods','Uma Rossi','uma.rossi@example.com','rejected',678,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('packaging-designer-verdant-foods','Mei Zhao','mei.zhao@example.com','rejected',206,NULL),('packaging-designer-verdant-foods','Farid Brooks','farid.brooks@example.com','rejected',653,NULL),('technical-writer-quillstack','Yara Chen','yara.chen@example.com','reviewed',104,'Excited about this: it matches what I want to do next.'),('technical-writer-quillstack','Carla Aziz','carla.aziz@example.com','new',45,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('technical-writer-quillstack','Aisha Novak','aisha.novak@example.com','reviewed',121,'Excited about this: it matches what I want to do next.'),('technical-writer-quillstack','Emma Singh','emma.singh@example.com','rejected',154,NULL),('technical-writer-quillstack','Victor Murphy','victor.murphy@example.com','new',142,'I am based nearby and can start within a month.'),('technical-writer-quillstack','Emma Khan','emma.khan@example.com','new',168,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('engineering-manager-coach-quillstack','Yara Novak','yara.novak@example.com','reviewed',101,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('engineering-manager-coach-quillstack','Aisha Costa','aisha.costa@example.com','new',151,'I am based nearby and can start within a month.'),('engineering-manager-coach-quillstack','Hiro Hart','hiro.hart@example.com','reviewed',168,NULL),('engineering-manager-coach-quillstack','Rosa Brooks','rosa.brooks@example.com','rejected',69,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('senior-backend-engineer-payments-meridian-bank','Liam Petrova','liam.petrova@example.com','shortlisted',39,'I am based nearby and can start within a month.'),('senior-backend-engineer-payments-meridian-bank','Noah Reed','noah.reed@example.com','new',36,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('senior-backend-engineer-payments-meridian-bank','Quinn Reed','quinn.reed@example.com','new',30,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('senior-backend-engineer-payments-meridian-bank','Tara Khan','tara.khan@example.com','rejected',11,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('senior-backend-engineer-payments-meridian-bank','Emma Silva','emma.silva@example.com','reviewed',48,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('compliance-analyst-meridian-bank','Ben Iyer','ben.iyer@example.com','shortlisted',134,'I am based nearby and can start within a month.'),('compliance-analyst-meridian-bank','Rosa Silva','rosa.silva@example.com','rejected',200,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('compliance-analyst-meridian-bank','Rosa Walker','rosa.walker@example.com','new',50,NULL),('compliance-analyst-meridian-bank','Ben Hart','ben.hart@example.com','new',131,NULL),('lifecycle-marketing-manager-meridian-bank','Aisha Hart','aisha.hart@example.com','new',228,NULL),('lifecycle-marketing-manager-meridian-bank','Tara Reed','tara.reed@example.com','reviewed',264,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('lifecycle-marketing-manager-meridian-bank','Wen Costa','wen.costa@example.com','reviewed',262,'I am based nearby and can start within a month.'),('lifecycle-marketing-manager-meridian-bank','Pablo Reed','pablo.reed@example.com','new',269,NULL),('gameplay-programmer-c-pixel-forge','Grace Petrova','grace.petrova@example.com','new',55,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('gameplay-programmer-c-pixel-forge','Mei Petrova','mei.petrova@example.com','new',11,'Excited about this: it matches what I want to do next.'),('gameplay-programmer-c-pixel-forge','Hiro Brooks','hiro.brooks@example.com','new',29,'Excited about this: it matches what I want to do next.'),('gameplay-programmer-c-pixel-forge','Jonas Alvarez','jonas.alvarez@example.com','rejected',21,'Excited about this: it matches what I want to do next.'),('game-artist-2d-ui-pixel-forge','Victor Murphy','victor.murphy@example.com','new',66,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('game-artist-2d-ui-pixel-forge','Olga Tanaka','olga.tanaka@example.com','shortlisted',26,NULL),('game-artist-2d-ui-pixel-forge','Pablo Haddad','pablo.haddad@example.com','shortlisted',59,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('game-artist-2d-ui-pixel-forge','Wen Brooks','wen.brooks@example.com','reviewed',105,NULL),('game-artist-2d-ui-pixel-forge','Noah Kim','noah.kim@example.com','new',83,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('narrative-designer-pixel-forge','Liam Khan','liam.khan@example.com','new',285,NULL),('narrative-designer-pixel-forge','Olga Zhao','olga.zhao@example.com','new',198,NULL),('narrative-designer-pixel-forge','Quinn Singh','quinn.singh@example.com','new',264,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('narrative-designer-pixel-forge','Diego Tanaka','diego.tanaka@example.com','new',45,NULL),('narrative-designer-pixel-forge','Ines Walker','ines.walker@example.com','rejected',94,NULL),('learning-experience-coach-cedar-co','Emma Brooks','emma.brooks@example.com','rejected',118,'Excited about this: it matches what I want to do next.'),('learning-experience-coach-cedar-co','Ines Chen','ines.chen@example.com','new',70,'I am based nearby and can start within a month.'),('learning-experience-coach-cedar-co','Sven Silva','sven.silva@example.com','shortlisted',43,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('learning-experience-coach-cedar-co','Ines Walker','ines.walker@example.com','rejected',90,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('learning-experience-coach-cedar-co','Noah Rossi','noah.rossi@example.com','new',4,'Excited about this: it matches what I want to do next.'),('learning-experience-coach-cedar-co','Carla Costa','carla.costa@example.com','new',79,'Your team''s approach to this role really stood out to me. Happy to share examples of my work.'),('frontend-engineer-education-cedar-co','Diego Petrova','diego.petrova@example.com','new',175,'I am based nearby and can start within a month.'),('frontend-engineer-education-cedar-co','Noah Costa','noah.costa@example.com','reviewed',68,'I have spent the last few years doing very similar work and would love to bring that experience here.'),('partnerships-coordinator-cedar-co','Wen Tanaka','wen.tanaka@example.com','new',167,NULL),('partnerships-coordinator-cedar-co','Ben Haddad','ben.haddad@example.com','new',321,'Excited about this: it matches what I want to do next.'),('partnerships-coordinator-cedar-co','Jonas Reed','jonas.reed@example.com','rejected',212,NULL),('partnerships-coordinator-cedar-co','Olga Reed','olga.reed@example.com','shortlisted',184,NULL)) AS v(job,name,email,status,h,note)
JOIN "jobs" j ON j."slug"=v.job
WHERE NOT EXISTS (SELECT 1 FROM "applications" a WHERE a."job_id"=j."id" AND a."email"=v.email);

INSERT INTO "listing_orders" ("checkout_id","company_id","user_id","job_id","tier_id","kind","status","price_key","amount_cents","currency","tier_name","duration_days","includes_featured","paid_at","updated_at","created_at")
SELECT 'pcs_demo_' || j."slug", c."id", u."id", j."id", t."id", 'new', 'paid', t."price_key", t."price_cents", t."currency", t."name", t."duration_days", t."includes_featured", j."published_at", now(), j."published_at"
FROM "jobs" j JOIN "companies" c ON c."id"=j."company_id" AND c."slug"='harbor-pine'
JOIN "users" u ON u."email"='employer@talenttrail.test'
JOIN "listing_tiers" t ON t."name" = CASE WHEN j."is_featured" THEN 'Featured' ELSE 'Standard' END
WHERE j."status" IN ('published','expired') AND NOT EXISTS (SELECT 1 FROM "listing_orders" o WHERE o."checkout_id"='pcs_demo_' || j."slug");

INSERT INTO "email_logs" ("template_key","to_address","status","error","created_at","updated_at") SELECT v.*, now() FROM (VALUES ('job-approved','ines.walker@example.com','sent',NULL,now() - make_interval(hours => 8)),('application-confirmation','rosa.kim@example.com','skipped',NULL,now() - make_interval(hours => 264)),('job-submitted','olga.alvarez@example.com','sent',NULL,now() - make_interval(hours => 222)),('job-expired','rosa.chen@example.com','sent',NULL,now() - make_interval(hours => 260)),('job-approved','hiro.iyer@example.com','sent',NULL,now() - make_interval(hours => 102)),('job-rejected','mei.murphy@example.com','sent',NULL,now() - make_interval(hours => 28)),('job-rejected','aisha.rossi@example.com','sent',NULL,now() - make_interval(hours => 131)),('job-submitted','ben.rossi@example.com','sent',NULL,now() - make_interval(hours => 196)),('job-rejected','victor.berg@example.com','skipped',NULL,now() - make_interval(hours => 125)),('job-expired','ben.petrova@example.com','sent',NULL,now() - make_interval(hours => 95)),('new-applicant','olga.khan@example.com','sent',NULL,now() - make_interval(hours => 135)),('job-approved','rosa.iyer@example.com','sent',NULL,now() - make_interval(hours => 126)),('application-confirmation','grace.murphy@example.com','sent',NULL,now() - make_interval(hours => 94)),('application-confirmation','mei.rossi@example.com','sent',NULL,now() - make_interval(hours => 244)),('job-approved','uma.kim@example.com','skipped',NULL,now() - make_interval(hours => 128)),('order-receipt','carla.costa@example.com','sent',NULL,now() - make_interval(hours => 46)),('new-applicant','sven.walker@example.com','sent',NULL,now() - make_interval(hours => 202)),('application-confirmation','jonas.rao@example.com','sent',NULL,now() - make_interval(hours => 120)),('application-confirmation','quinn.hart@example.com','failed','Mail service timed out.',now() - make_interval(hours => 80)),('job-expired','mei.hart@example.com','failed','Mail service timed out.',now() - make_interval(hours => 167)),('job-expired','emma.berg@example.com','sent',NULL,now() - make_interval(hours => 75)),('application-confirmation','uma.brooks@example.com','skipped',NULL,now() - make_interval(hours => 259)),('new-applicant','zane.reed@example.com','skipped',NULL,now() - make_interval(hours => 292)),('job-rejected','victor.larsen@example.com','sent',NULL,now() - make_interval(hours => 118)),('application-confirmation','ben.novak@example.com','sent',NULL,now() - make_interval(hours => 185)),('application-confirmation','olga.mendes@example.com','sent',NULL,now() - make_interval(hours => 26)),('job-expired','uma.mendes@example.com','sent',NULL,now() - make_interval(hours => 126)),('job-submitted','aisha.petrova@example.com','sent',NULL,now() - make_interval(hours => 36)),('job-expired','rosa.rossi@example.com','skipped',NULL,now() - make_interval(hours => 270)),('application-confirmation','ines.rossi@example.com','sent',NULL,now() - make_interval(hours => 136))) AS v(t,a,s,e,c) WHERE (SELECT count(*) FROM "email_logs") < 10;

UPDATE "jobs" j SET "application_count" = (SELECT count(*)::int FROM "applications" a WHERE a."job_id" = j."id") WHERE j."is_seed";
UPDATE "companies" c SET "active_job_count" = (SELECT count(*)::int FROM "jobs" j WHERE j."company_id"=c."id" AND j."status"='published' AND j."expires_at" > now()) WHERE c."is_seed";
COMMIT;
