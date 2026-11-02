# Moving Talent Trail Hub onto the Astro platform template

The old app (TanStack Start) is in `~/projects/talent-trail-hub-old` (full code, git history).
Its product spec is `~/projects/talent-trail-hub-old/docs/SPEC.md`: **Release 1** is what we port
(F1–F6, F10–F12, F15–F21, F25, F30, F34, F36 purge + privacy tool, F37, F39, listing tiers,
featured pin cap). Release 2 items stay out unless listed below.

Platform rules: `AGENTS.md` (read it first) and `docs/agent/<topic>.md`. They win over the old
app's habits. Never edit `src/platform/**` or `docs/agent/**`.

## Decisions (old app → new platform)

| Old | New |
| --- | --- |
| UUID ids | `Int` autoincrement ids (template convention); unguessable tokens where an id would leak |
| Own sessions, admin/employer roles, `/login`, `/signup` | Template auth (`/account/*`). **Employer = any signed-in, verified user**; they own at most ONE company (`companies.owner_user_id`). Admin abilities = codenames in `src/server/permissions.ts` (`site:job:manage`, `site:job:moderate`, `site:applicant:read`, `site:privacy:manage`, `site:board:settings`, `site:board:reports`), granted to the `admin` role; owners have `*`. `/signup` → `/account/register/?next=/dashboard/post-a-job` |
| `/admin/*`, `/employer/*` pages | Screens in the `/dashboard` portal (SPA, `src/portal/`, the UI kit `src/portal/ui/`). Admin screens under `/dashboard/manage/...`, employer screens under `/dashboard/employer/...`; the wizard at `/dashboard/post-a-job` |
| Stripe Checkout with inline prices | Built-in payments (`docs/agent/payments.md`). Each listing tier names a **catalogue price key** (`listing_tiers.price_key`); the amount charged is the catalogue's. Prices are created in the editor (`npm run platform -- prices add …`), not by the live site, so the admin's tier editor PICKS a catalogue key (shows `listPrices()`), sets days and featured. Free posting skips checkout ($0 `listing_orders` row) |
| Stripe webhook | `src/server/payments-hooks.ts` `onCheckoutPaid` → find `listing_orders` by `checkout_id` (NEVER trust browser `metadata`) → mark paid → `submissionTarget` + `publishJob` / review |
| One-click Stripe refund on reject | Not available on the platform: reject shows "Refund this order in the platform dashboard"; `onRefund` marks the listing order refunded |
| Storage provider | Platform files (`docs/agent/files.md`): resumes PRIVATE, logos PUBLIC |
| Email provider | Board emails via `sendBoardEmail` (`src/server/board/email.ts`), logged in `email_logs`. Sent through Resend when the owner adds the `RESEND_API_KEY` secret (`config.ownerSecret`), else logged `skipped`. Account emails stay the platform's |
| Cron / traffic trigger, `TaskLock` | Background jobs (`docs/agent/background-jobs.md`): handlers in `src/server/background.ts`, schedules in `background.json`, calling `runExpiry` / `runPurge` (`src/server/board/tasks.ts`) |
| AuditLog | The platform's `audit()` (`src/platform/auth`), shown in the template's `/dashboard/activity` WITHOUT the old app's filters (that screen is the template's; a filtered board log is Release 2; decided 2026-10-30: the screen stays platform-shaped, no action/target filters now) |
| Rate-limit counters | `board_attempts` (keyed IP hashes, `src/server/board/ip.ts`) |
| Blog (template) | Removed (owner decision 2026-11-02) |
| Board currency | USD everywhere (owner decision 2026-10-30): tier prices in the catalogue and `board_settings.currency` (default `USD`) |
| Renew a listing | Renewing a live job keeps the remaining days: the tier's days are added to the current expiry; a job that is down starts from today (owner decision 2026-10-30) |
| Refund of a renewal | A full refund of a RENEW order takes the whole job down, including the time paid for earlier (owner decision 2026-10-30, intended) |
| Rich-text sanitizer | `src/lib/rich-text.ts` (the `xss` package with the board's strict allow-list p, ul, ol, li, strong, em, a, h3, h4, br) on write; pages render it through the platform's `sanitizeHtml` as well, by decision (the platform's list is wider: iframes, images) |
| Theme flash on first load | ONE fixed inline `<head>` script (`src/lib/theme-boot.ts`) applies the saved theme before paint; its hash is added to the page CSP (`Astro.csp.insertScriptHash`), a unit test keeps the hash in step. The only `is:inline` script, by decision |
| Status emails to candidates (old: once in total) | Owner decision 2026-10-30: at most one shortlisted (`statusEmailedAt`) and one rejected (`rejectedEmailedAt`) email per application |

## Shared foundation (done; change only with care, tell the others)
- `prisma/schema.prisma` + migration `*_job_board`: all board tables. Need a column? Add a NEW
  migration (`docs/agent/database.md`); coordinate, one at a time.
- `src/lib/board.ts`: fixed sets, labels, LIMITS, RESUME_RETENTION_DAYS (browser-safe).
- `src/lib/rich-text.ts` (`sanitizeRichText`, `htmlToText`: the board's strict allow-list), `src/lib/slug.ts`.
- `src/server/board/`: `settings.ts` (`getBoardSettings`, `isSingleCompany`), `public.ts`
  (`publicJobWhere`, `featuredWhere`: EVERY public job read), `ip.ts` (`ipHashOf`), `slug.ts`
  (`createWithUniqueSlug`), `lifecycle.ts` (`submissionTarget`, `publishJob`), and stubs owned below:
  `email.ts` (E), `review.ts` (D), `tasks.ts` (E).
- Site API mounts (`src/server/app.ts`): `/jobs`, `/companies`, `/board` (A), `/applications` (B),
  `/employer` (C), `/manage` (D). `/me` also answers `board: {singleCompany}`.
- Portal: `src/portal/employer/routes.tsx` (C) and `src/portal/admin/routes.tsx` (D) export their
  routes + nav groups, spread into `src/portal/routes.tsx`. Overview slots:
  `src/portal/employer/OverviewPanel.tsx` (C), `src/portal/admin/OverviewPanel.tsx` (D).
  Applicants screens: `src/portal/applicants/ApplicantsScreen.tsx` (B; C and D register routes).
- API shapes per area: `src/lib/types-public.ts` (A), `types-apply.ts` (B), `types-employer.ts` (C), `types-manage.ts` (D).

## Workstreams (each owns its files; never edit another's)
- **A, public site**: home (F1), `/jobs/` search + filters + featured pin cap + `?featured=1` (F2),
  `/jobs/<slug>/` detail + JSON-LD + view count + similar + closed banner (F3), companies (F5), saved (F6),
  `/pricing/`, `/post-a-job/` landing, `/privacy/`, `/terms/`, sitemap/robots/SEO (F34), runtime
  branding (F30) in `Base.astro` + header/footer, single-company effects on public pages (F39).
  Files: `src/pages/**` (not `site-api`, `checkout`, `thanks`, `portal`, `dashboard`), `src/layouts/`,
  `src/components/**` (not `apply/`, `payments/`), `src/content/site.ts`, `src/styles/`,
  `src/server/routes/{jobs,companies,board}.ts`, `src/lib/types-public.ts`, `src/lib/seo.ts`, `src/lib/job-display.ts`, `src/lib/json-ld.ts`.
- **B, apply + applicants**: apply form on the job page (`src/components/apply/`, included by A's
  detail page as `<ApplySection job={…} />`), resume upload, apply (F4, consent F36, honeypot, 5/IP/h,
  duplicate email → friendly 409), apply-click count for url/email methods, emails to candidate +
  employer, resume links (10 min, retention guard 410 `resume_expired`, admin downloads audited),
  applicants API (own company or `site:applicant:read`; status, notes, CSV, status emails once) and the
  shared applicants screens. Files: `src/server/routes/applications.ts`, `src/server/board/applicants.ts`,
  `src/components/apply/`, `src/portal/applicants/`, `src/lib/types-apply.ts`.
- **C, employer**: company editor (F17, public logo), post-a-job wizard (F10, Markdown → sanitized HTML,
  tier picker, preview, draft in localStorage), checkout + payment hooks (F12), free posting, my jobs
  (F15: edit → re-review, close as filled, renew with tier picker, duplicate), billing + receipt (F18),
  employer overview panel. Everything 404 in single-company mode. Files: `src/server/routes/employer.ts`,
  `src/server/board/employer*.ts`, `src/lib/markdown.ts`, `src/server/payments-hooks.ts`,
  `src/portal/employer/**`, `src/lib/types-employer.ts`. Also owns `src/portal/board/JobForm.tsx`
  (job fields form, reused by D for admin jobs).
- **D, admin**: overview panel (F19), moderation queue + review (F20, `notifyReviewers`), jobs (F21:
  filters, free admin jobs via C's JobForm, edit lock 403 `employer_job_locked`, feature, extend, close,
  delete, "Run expiry now"), admin applicants route (F39), listing tiers + free posting (F25), privacy tool
  (F36, "Run purge now"), email log, settings: branding (F30), board mode (F39), moderation mode (F31).
  Files: `src/server/routes/manage.ts`, `src/server/board/manage*.ts`, `src/server/board/review.ts`,
  `src/portal/admin/**`, `src/lib/types-manage.ts`. Update `tests/integration/admin.test.ts` lines
  that call the removed `/site-api/jobs/manage` to D's admin jobs list.
- **E, background, emails, seed, tests**: `sendBoardEmail` with templates ported from the old
  `src/emails/*.md` (`src/server/board/emails/`), `runExpiry` (jobs + featured, reminder 3 days before,
  expired email) and `runPurge` (resumes after 180 days, stale `resume_uploads`, old `board_attempts`),
  `src/server/background.ts` + `background.json` (expire hourly, purge daily), `prisma/seed.sql`
  (fake board data per SPEC "Defaults"), and the required tests (pricing, expiry, slug uniqueness).
  Files: `src/server/board/{email,tasks}.ts`, `src/server/board/emails/`, `src/server/background.ts`,
  `background.json`, `prisma/seed.sql`, new files in `tests/`.

## Working rules for the agents
- Machine: other agents run at the same time. Do NOT run `npm run build`, `astro dev`, `npm install`
  or `prisma migrate`. Check with `npx tsc --noEmit -p .` (errors in other areas' files are not yours)
  and `npx vitest run <your test files>`.
- Integration tests: your OWN database only (each agent is given one), e.g.
  `TEST_DATABASE_URL=<yours> JWT_SECRET=test-secret-for-integration-tests-only-0123456789 npx vitest run tests/integration/<file>`.
  Never the dev database (port 51222).
- New tests only for payments, pricing, permissions, auth, security and data integrity.
- Every route: validator → guards (`withViewer`, `requireAuth`, `requirePermission`, `withDb`) →
  explicit `select`, keyset paging, `take` ≤ 100. Employers only reach their own company (404 otherwise).
- UI: the portal kit only; public pages follow `src/styles/` tokens. Forms and buttons follow AGENTS.md.

## Owner to-dos (cannot be done from code)
- Add `JWT_SECRET` (and optionally `SITE_KEY`) to `.env` for local sign-in.
- Create the tier prices in the editor: `npm run platform -- prices add --key listing-standard-30 --name "Standard listing" --amount-cents 9900 --currency USD --interval one_time`.
- Turn on Storage (resumes, logos) and payments in the site's dashboard; add `RESEND_API_KEY` for board emails.

## Status (2026-10-30 18:45)
- All five workstreams done and reviewed (code, security, performance, UI, accessibility, parity);
  review findings fixed. `npm run build` passes, `npx tsc --noEmit -p .` is clean.
- Full `npm test` with TEST_DATABASE_URL: 256 / 260 pass. The 4 failures are the TEMPLATE's
  concurrency tests (PIPE-10, PIPE-12, PIPE-13, rate-limit-busy): the local `prisma dev` database
  serves one connection at a time; they failed the same way on the untouched template. Re-run them
  against a real Postgres (the Preview Database) before trusting them either way.
- docs/PARITY.md: remaining gaps are small (see its "Remaining gaps"); decisions above.
- Next: owner checks the UI in a browser (needs JWT_SECRET in .env for sign-in), owner to-dos below,
  first Publish (the job_board migration asks for approval), then Release 2 (PROGRESS.md).
- Local databases (`npx prisma dev ls`): dev `tth-v2` (TCP localhost:51222, in .env), test DBs
  tth-test-a..e (51230, 51234, 51238, 51242, 51246). Old app's DB `jobboard` untouched.
