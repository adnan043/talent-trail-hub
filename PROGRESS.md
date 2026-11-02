# PROGRESS — Talent Trail Hub (Astro platform)

Short status and plan. The old app (TanStack Start) and its history: `~/projects/talent-trail-hub-old`
(its spec: `docs/SPEC.md` there). How the port was planned and decided: [docs/MIGRATION.md](docs/MIGRATION.md).
Feature-by-feature check against the old app: [docs/PARITY.md](docs/PARITY.md).
Publishing runbook: [docs/GO-LIVE.md](docs/GO-LIVE.md). Rules for code changes: [AGENTS.md](AGENTS.md).

## Current status (2026-10-30)
- **Release 1 ported** onto the platform template: one Astro site on one Cloudflare Worker, Hono as the
  backend (`/site-api`), the signed-in parts as screens in the `/dashboard` portal.
- `npm run build` passes and `npx tsc --noEmit -p .` is clean (re-run 2026-10-30 18:44).
- What works, by area:
  - **Public site**: home, `/jobs/` search with filters, featured pin cap and `?featured=1`, job page with
    JSON-LD, view count, similar jobs and the closed banner, companies, saved jobs, `/pricing/`,
    `/post-a-job/`, `/privacy/`, `/terms/`, sitemap, robots, runtime branding, single-company mode.
  - **Blog**: the template's blog is visible again (nav link, owner decision 2026-10-30).
  - **Apply + applicants**: apply without an account (consent, honeypot, 5 per IP per hour, duplicate email
    → friendly message), resume upload to private platform files, apply-click count, emails to candidate
    and employer, applicants list with status, notes, CSV, 10-minute resume links, 180-day retention guard.
  - **Employer**: company editor with public logo, post-a-job wizard (Markdown → sanitized HTML, tier
    picker, preview, draft kept in the browser), checkout through built-in payments, free posting, my jobs
    (edit → re-review, close, renew, duplicate), billing and printable receipt.
  - **Admin** (`/dashboard/manage/...`): overview, moderation queue and review, jobs (filters, free admin
    jobs, edit lock on employer jobs, feature, extend, close, delete, "Run expiry now"), listing tiers and
    free posting, privacy tool ("Run purge now"), email log, settings (branding, board mode, moderation mode).
  - **Background**: expiry hourly and resume purge daily as platform background jobs (`background.json`);
    board emails logged in `email_logs`, sent through Resend once `RESEND_API_KEY` is added.
- Tests: full `npm test` with `TEST_DATABASE_URL` → **256 of 260 pass** (36 files). Board tests cover the
  public site, apply + applicants, employer, payments (paid hook idempotency, refunds, renew), admin,
  expiry/purge, emails, JSON-LD, Markdown and one end-to-end journey (`board-flow`).
  - The 4 failures are the TEMPLATE's concurrency tests (PIPE-10, PIPE-12, PIPE-13, rate-limit-busy): the
    local `prisma dev` database serves one connection at a time. They failed the same way on the
    untouched template; re-run them against the Preview Database.
- **Remaining gaps**: small; see docs/PARITY.md "Remaining gaps".

## Next steps
1. **Finish the gaps** in docs/PARITY.md, then one `npm run build`, `npx tsc --noEmit -p .` and a full
   `npm test` with `TEST_DATABASE_URL`; fix what breaks; review the whole change.
2. **Owner browser check** (light and dark, 1440 px and 390 px) in the editor Preview: home, `/jobs/`
   filters and featured, a job page with apply and upload, `/account/*` sign-up and sign-in, the
   post-a-job wizard with 1, 2 and 3 tiers, the employer screens, every admin screen, single-company mode.
3. **Owner to-dos** (from docs/MIGRATION.md; cannot be done from code):
   - Add `JWT_SECRET` (and optionally `SITE_KEY`) to `.env` for local sign-in.
   - Create the three tier prices (dummy values for now; change the tiers later in the admin). Run these in
     the editor's terminal (they need the editor's SITE_URL / SITE_KEY):
     ```
     npm run platform -- prices add --key listing-basic-30 --name "Basic listing" --amount-cents 4900 --currency USD --interval one_time
     npm run platform -- prices add --key listing-standard-30 --name "Standard listing" --amount-cents 9900 --currency USD --interval one_time
     npm run platform -- prices add --key listing-featured-30 --name "Featured listing" --amount-cents 19900 --currency USD --interval one_time
     ```
     The Standard tier comes from the job_board migration; Basic and Featured are seeded in the Preview
     only (`prisma/seed.sql`). On the live site, add Basic and Featured in the admin's listing tiers screen.
   - Turn on Storage (resumes, logos) and payments in the site's dashboard; add `RESEND_API_KEY` for board emails.
   - Then follow docs/GO-LIVE.md (publish, first-day checklist, connect the live payment gateway).
4. **Answer the open questions** below.
5. **Start Release 2** (plan below), one group at a time.

## Open questions for the owner
1. **Legacy `.doc` resumes**: the platform's storage does not take `.doc` (`application/msword`), so only
   PDF and DOCX are accepted (the old app took `.doc` too). Is that acceptable? (Until answered: PDF and DOCX.)

## Decisions in force
Full table and reasons: [docs/MIGRATION.md](docs/MIGRATION.md) "Decisions".
- **Owner decisions 2026-10-30** (answered open questions):
  - Currency: **USD everywhere** (tier prices and `board_settings.currency`, which defaults to USD).
  - Blog: **kept and shown** in the nav again (`src/content/blog/`, `src/pages/blog/`).
  - Tiers: dummy values for now, the owner changes them later in the admin. Basic 30 days $49
    (`listing-basic-30`), Standard 30 days $99 (`listing-standard-30`), Featured 30 days $199, featured
    (`listing-featured-30`).
  - Refunds: a manual refund in the platform dashboard is acceptable (no one-click refund).
  - A full refund of a RENEW order takes the whole job down, including the time paid earlier: intended.
  - Renewing a live job keeps the remaining days (the new days are added to the current expiry); a job
    that is down starts from today.
  - Privacy and terms: the current placeholder text stays for launch.
  - Candidate status emails: at most ONE shortlisted and ONE rejected email per application
    (`status_emailed_at`, `rejected_emailed_at`; migration `20261030131543_application_rejected_emailed_at`),
    so a candidate shortlisted then rejected still hears the outcome; moving back and forth never resends.
  - Board mode at launch: **marketplace** (many companies; already the default `board_mode`).
  - Resume retention: **180 days** (`RESUME_RETENTION_DAYS`).
- Int autoincrement ids; unguessable tokens where an id would leak.
- Sign-in is the platform's (`/account/*`). An employer is any signed-in, verified user with at most ONE
  company. `/signup` → `/account/register/?next=/dashboard/post-a-job`.
- Admin abilities are permission codenames in `src/server/permissions.ts` (`site:job:manage`,
  `site:job:moderate`, `site:applicant:read`, `site:privacy:manage`, `site:board:settings`,
  `site:board:reports`), granted to the `admin` role; owners have all.
- Admin and employer screens live in `/dashboard` (`/dashboard/manage/...`, `/dashboard/employer/...`,
  wizard at `/dashboard/post-a-job`).
- Payments are built in: each tier names a catalogue price key; the amount is the catalogue's; the paid
  hook finds the order by `checkout_id`, never by browser data. Free posting skips checkout.
- Resumes are private platform files, logos public. Board emails via `sendBoardEmail`, logged.
- Later work is platform background jobs; audit is the platform's `audit()` in `/dashboard/activity`.
- Every public job read goes through `publicJobWhere` / `featuredWhere` (`src/server/board/public.ts`).
- Kept from the old app: money in integer cents; 1–3 active tiers, the client sends only `tierId`;
  featured pin cap 5 per list, hourly rotation; admin cannot edit employer jobs (403 `employer_job_locked`);
  approving an edit of a live job keeps its dates; resume retention 180 days (`RESUME_RETENTION_DAYS`).

## Release 2 plan
From the old SPEC "Releases" (everything not in Release 1). Groups are a sketch; refine before starting.
Every new table: a NEW migration (`docs/agent/database.md`); every admin feature: a `CATALOGUE` entry.
- **Alerts, reports, spam**: F7 job alerts (subscribe, double opt-in, confirm/unsubscribe pages, daily and
  weekly digests) → routes in `src/server/routes/` (new `alerts.ts`), pages `src/pages/alerts/`, digest
  handler in `src/server/background.ts` + `background.json`, templates in `src/server/board/emails/`.
  F8 job reports (dialog on the job page, threshold → review, reports in the moderation queue; the
  `site:board:reports` codename exists) → `src/server/board/manage-moderation.ts`, `src/portal/admin/screens/`.
  F35 limits and blocked domains/keywords → `src/server/board/` + `board_attempts`.
- **Packs, featured upgrade, coupons**: F13 packs and credits, F14 "upgrade to featured" from my jobs, F18
  credit ledger on billing, F26 coupons → catalogue prices (`docs/agent/payments.md`),
  `src/server/payments-hooks.ts`, `src/server/board/employer-*.ts`, `src/portal/employer/screens/`.
  Credit expiry as a background job.
- **Records**: F23 employers (detail, trust, block, grant credits), F24 applications search, F27 categories,
  F28 subscribers, F29 orders list + CSV → `src/server/routes/manage.ts`, `src/server/board/manage-*.ts`,
  new screens in `src/portal/admin/screens/` registered in `src/portal/admin/routes.tsx`.
- **Configuration and content**: F31 other board rules, F32 email template editor, F36 consent, privacy and
  terms editors, F30 dark-mode logo, F22 CSV import → `src/server/board/manage-settings.ts`,
  `src/portal/admin/screens/settings-*.tsx`; editable privacy/terms pages become SSR pages reading a table.
- **Integrations**: F33 webhooks (outbound `fetch` + retries as a background job), F38 EzyCourse sync
  (key via `config.ownerSecret`), F9 embed and feeds → new routes in `src/server/routes/`, feeds in `src/pages/`.
- **Hardening**: re-check every feature, WCAG, performance, security (`docs/agent/security.md` checklist).

## Where things are
| What | Where |
| --- | --- |
| Public pages (home, jobs, companies, saved, pricing, post-a-job, legal, checkout, thanks) | `src/pages/` |
| Layout, header, footer, branding | `src/layouts/Base.astro`, `src/components/`, `src/content/site.ts` |
| Apply form on the job page | `src/components/apply/` |
| Site API routes | `src/server/routes/` (`jobs`, `companies`, `board`, `applications`, `applications-manage`, `employer`, `checkout`, `manage`), mounted in `src/server/app.ts` |
| Board logic (public queries, lifecycle, employer, admin, emails, expiry/purge) | `src/server/board/` (`public*.ts`, `lifecycle.ts`, `employer*.ts`, `manage*.ts`, `email.ts`, `emails/`, `tasks.ts`) |
| Payments hook | `src/server/payments-hooks.ts` |
| Background jobs | `src/server/background.ts`, `background.json` |
| Permissions | `src/server/permissions.ts` |
| Portal: employer / admin / applicants / shared job form | `src/portal/employer/`, `src/portal/admin/`, `src/portal/applicants/`, `src/portal/board/JobForm.tsx` |
| Shared rules and types | `src/lib/board.ts`, `src/lib/rich-text.ts`, `src/lib/types-*.ts` |
| Database | `prisma/schema.prisma`, `prisma/migrations/` (board: `*_job_board`, `*_job_featured_sweep_index`), `prisma/seed.sql` |
| Tests | `tests/` (unit), `tests/integration/` (needs `TEST_DATABASE_URL`) |
| Managed (never edit) | `src/platform/`, `docs/agent/` |
