# Release 1 feature parity: old app → new platform

Audit of the old app (`~/projects/talent-trail-hub-old`: `docs/SPEC.md` Release 1, `PROGRESS.md`,
`docs/archive/release-1.md`) against the PORTED code in this repo (`src/`, `tests/`, `prisma/`,
`background.json`) and the running dev site. Re-audited 2026-10-30 after workstreams A–E
(`docs/MIGRATION.md`). Paths below are relative to `src/` unless they start with `tests/`,
`prisma/` or `background.json`.

Status:
- **DONE**: the behaviour is in the code (file cited).
- **PARTIAL**: some of it is in the code; what is missing is named.
- **MISSING**: not in the code.
- **CHANGED-BY-PLATFORM**: a MIGRATION decision (or the platform) replaces or drops it.
- **out (R2)**: Release 2 in the old app; not ported.

## A. Public site

| Feature/behaviour | Status |
| --- | --- |
| Home hero from settings (`*phrase*` → `<mark>`), GET search → `/jobs/?q=` | DONE `pages/index.astro` |
| Home "N open roles" eyebrow | DONE `pages/index.astro` (sum of category counts) |
| Home "Popular" chips (Remote + 4 biggest categories) | DONE `pages/index.astro` |
| Home "Hiring now" strip: top 6 companies BY OPEN JOBS | PARTIAL: shows the companies of the 10 newest jobs (`server/routes/board.ts` `/home`), not ranked by open jobs |
| Home category tiles, featured, 10 latest, employer CTA | PARTIAL: tiles, featured (≤5 pinned), 10 latest, CTA done (`pages/index.astro`); the latest list has a workplace switch (`?workplace=`) |
| Home zero jobs → "Post the first job" (not in single-company) | DONE `pages/index.astro` (`HOME.empty` / `emptySingle`) |
| Home featured obeys the pin cap (≤5, hourly rotation) | DONE `server/routes/board.ts` (`pinnedIds`) |
| Release 2 UI hidden (no alerts card, links, `/alerts`) | DONE (no alert UI in `pages/`, `components/`, `layouts/`) |
| `/jobs` filters: keyword (title, company, tags, description, ≤5 terms), category, type, workplace, location (country → ISO, "remote"), min salary, posted, sort | DONE `server/board/public-search.ts`, `lib/job-search.ts`, `pages/jobs/index.astro` |
| Min salary annualised (hour ×2080 … month ×12), board currency only | DONE `server/board/public-search.ts` (`PERIODS_PER_YEAR`, `minSalaryWhere`) |
| Filters in URL; location typing debounced; mobile sheet "Show N jobs"; Clear filters; no-results | PARTIAL: URL (GET form), auto-submit on selects, Clear, no-results done (`pages/jobs/index.astro`); no debounced location typing, mobile filters are a `<details>` without "Show N jobs" |
| Only published + unexpired + company not blocked; 20/page; featured pinned first | DONE `server/board/public.ts` (`publicJobWhere`), `server/board/public-search.ts` (keyset pages) |
| Featured pin cap: ≤5 on page 1, FNV-1a per UTC hour, from matching jobs, left out of the rest | DONE `server/board/public-search.ts`; `tests/json-ld.test.ts`, `tests/integration/public-board.test.ts` |
| "See all N featured jobs" → `/jobs/?featured=1`, removable chip, `noindex,follow`, not in sitemap | PARTIAL: link, chip, `noindex,follow` (checked live) and sitemap exclusion done; the link shows no N |
| Filtered/keyword/sort `/jobs` `noindex,follow`; canonical on plain + paginated lists | CHANGED-BY-PLATFORM: keyset paging (`?before=`), canonical always `/jobs/` (`pages/jobs/index.astro`); `noindex,follow` on filtered done |
| Job detail: facts, "Salary not disclosed", sanitized description, tags, company panel, similar (same category, other companies), "More jobs at" | DONE `pages/jobs/[slug].astro`, `server/routes/jobs.ts`, `lib/job-display.ts` |
| Detail share: Web Share, copy, LinkedIn, X, email | DONE `pages/jobs/[slug].astro` |
| Expired/closed → 200 + banner, no apply, no JSON-LD; draft/pending/rejected/blocked → 404 (outage 503) | DONE `pages/jobs/[slug].astro`, `lib/json-ld.ts`; `tests/integration/public-board.test.ts` |
| JobPosting JSON-LD (TELECOMMUTE + applicantLocationRequirements, baseSalary, validThrough, directApply, `<` escaped) | DONE `lib/json-ld.ts`; `tests/json-ld.test.ts` |
| View +1 per browser session, ≤120/IP-hash/hour, no `updatedAt` bump | DONE `pages/jobs/[slug].astro` (sessionStorage), `server/routes/jobs.ts` (`/:slug/view`, raw SQL); test in `public-board.test.ts` |
| Saved jobs (localStorage, tab sync), toggle on cards + job page, Expired label, "no longer available" + Remove, `noindex` | DONE `components/board/SaveButton.astro`, `lib/saved-jobs.ts`, `pages/saved.astro`, `server/routes/jobs.ts` (`POST /saved`) |
| `/companies`: ≥1 active job, MOST OPEN JOBS FIRST, 24/page; profile; unknown/blocked → 404 | PARTIAL: ≥1 job, 24/page, profile, 404 done (`server/routes/companies.ts`, `pages/companies/`); ordered by name, not by open jobs |
| `/pricing/` lists active tiers | DONE `pages/pricing.astro`, `server/routes/board.ts` (`/tiers`) |
| `/privacy/`, `/terms/` placeholder, indexable, footer legal links | DONE `pages/privacy.astro`, `pages/terms.astro`, `layouts/Base.astro` |
| Footer non-endorsement disclaimer + settings footer links | DONE `layouts/Base.astro` (`FOOTER_DISCLAIMER`, `data-footer-links`) |
| `/sitemap.xml` (jobs + companies, lastmod, 1 h); `/robots.txt` (Sitemap line) | DONE `pages/sitemap.xml.ts`, `pages/robots.txt.ts` (empty in dev: no site URL); private areas use `noindex`, not `Disallow` (platform rule) |
| Unique title/description/OG/Twitter/canonical per page | DONE `layouts/Base.astro`, `lib/seo.ts` |
| Runtime branding: colour → CSS vars, accessible foreground, font preset, logo, no rebuild | DONE `server/board/brand.ts` (`brandCss`), `layouts/Base.astro` |
| Brand colour kept WCAG AA per scheme | DONE `server/board/brand.ts`; `tests/json-ld.test.ts` ("keeps accent pairs at WCAG AA") |
| Public theme toggle Light / Dark / System, localStorage, applied BEFORE FIRST PAINT | PARTIAL: menu + storage done (`components/board/ThemeMenu.astro`); applied by a module script (runs after first paint), no head script, so a saved Dark flashes Light |
| Uploaded logos on a light plate in dark mode | DONE `styles/board.css` (`--logo-plate`) |
| Board favicon upload + `/favicon.ico` | CHANGED-BY-PLATFORM: platform `site.favIcon` (`layouts/Base.astro`); `/favicon.ico` answers 404 |
| Header/mobile/footer nav per board mode | DONE `server/board/brand.ts` (`[data-marketplace-only]` hidden), `layouts/Base.astro` |
| Single-company public effects (owner jobs only, `/companies` 404, owner profile + Organization JSON-LD on home, owner profile reachable) | DONE `server/board/public.ts`, `server/routes/companies.ts`, `pages/index.astro`, `lib/json-ld.ts`; `public-board.test.ts` |
| `/pricing/`, `/post-a-job/` 404 in single-company | DONE `pages/pricing.astro`, `pages/post-a-job.astro`, `server/routes/board.ts` |
| 404 page | CHANGED-BY-PLATFORM `pages/404.astro` |

## B. Apply and applicants

| Feature/behaviour | Status |
| --- | --- |
| On-site apply without account: name, email, resume, consent; phone, URL, cover note ≤3000 | DONE `server/routes/applications.ts`, `components/apply/` |
| Consent text (180 days) + timestamp stored | DONE `lib/board.ts` (`DEFAULT_CONSENT_TEXT`), `server/routes/applications.ts` |
| Resume PDF/DOC/DOCX ≤5 MB, TYPE CHECKED BY FIRST BYTES, private | PARTIAL: PDF/DOCX ≤5 MB private upload done (`server/routes/applications.ts`); only the declared content type is checked, no first-bytes check after `completeUpload`; `.doc` dropped (platform storage) |
| Upload progress in the form | DONE ("Uploading name (x MB)…" state; `putFile` cannot report bytes) `components/apply/apply-form.ts` |
| Duplicate email per job → 409; honeypot / >5 per IP-hash/hour → silent 201 | DONE `server/routes/applications.ts`; `tests/integration/applications.test.ts` |
| url/email apply link out + click counter capped per IP | DONE `server/routes/applications.ts` (`/jobs/:slug/click`, 120/h) |
| Emails to candidate + employer | DONE `server/board/applicants.ts` (`notifyNewApplication`) |
| `new-applicant` to ADMINS for ownerless companies / single-company, link `?job=<id>` | DONE `server/board/applicants.ts` links `?job=<id>`; `ApplicantsScreen.tsx` reads job/status from the URL |
| Apply form hidden for admin and the job's own employer (server refuses owner) | DONE `server/routes/applications.ts` (`/can-apply`, 403 `own_job`), `components/apply/apply-form.ts`; test |
| Applicants per job: status filter IN URL, table, sheet, optimistic status + rollback, notes, "Copy job link" empty state | PARTIAL: table, drawer, optimistic + rollback, notes done (`portal/applicants/`); status filter is component state (not in URL); empty state has no "Copy job link" |
| Statuses new/reviewed/shortlisted/rejected | DONE `lib/board.ts` (`APPLICATION_STATUSES`) |
| Shortlisted / rejected emails once, never notes | DONE `server/routes/applications-manage.ts` (conditional + `statusEmailedAt`); test |
| CSV: formula cells defused, Resume = file name or retention text; admin CSV + Job + Company, ≤5,000 rows | DONE `server/board/applicants.ts` (`csvCell`, `applicantsCsv`); `EXPORT_MAX` 5,000 |
| Resume link 10 min, scope re-checked, attachment | CHANGED-BY-PLATFORM: platform short link (`fileUrl`, 600 s, `download: true`) in `server/routes/applications-manage.ts`; not bound to the user |
| Admin resume downloads audit-logged | DONE `server/routes/applications-manage.ts` (`resume_downloaded`) |
| Retention guard: >180 days → 410 `resume_expired`; rows `resumeExpired`; UI/CSV text | DONE `server/routes/applications-manage.ts`, `lib/types-apply.ts`; test |
| Employer reaches only own company's applicants (404); admin via `site:applicant:read` | DONE `server/board/applicants.ts` (`applicantScope`); `applications.test.ts` |

## C. Employer

| Feature/behaviour | Status |
| --- | --- |
| Accounts `/login`, `/signup`, `/verify`, sessions 30 days | CHANGED-BY-PLATFORM: `/account/*`; `/signup/` → register with `next=/dashboard/post-a-job` (`pages/signup.astro`) |
| Inline account create in wizard step 2 | CHANGED-BY-PLATFORM (sign in first) |
| Paid jobs of unverified employers held | CHANGED-BY-PLATFORM: employer area needs a verified user (`server/routes/employer.ts` `requireVerified`) |
| Employer sign-up 404 in single-company | CHANGED-BY-PLATFORM: `/signup/` 404 (`pages/signup.astro`); `/account/register/` is platform-managed and stays |
| Wizard step 1 fields, description ≥200 Markdown → sanitized, ≤5 tags, apply method | DONE `portal/board/JobForm.tsx`, `lib/job-input.ts`, `lib/rich-text.ts` |
| Step IN URL; autosave 5 s + on step change; reused unpaid job; focus moves to the step | PARTIAL: 5 s autosave + reused `jobId` done (`portal/employer/screens/post-job.tsx`, `draft.ts`); step lives in localStorage, not the URL; step change only scrolls (no focus move) |
| Tier picker (none when one), only `tierId` sent, unknown → refused | DONE `server/board/employer-orders.ts` (`chooseTier`, 422 field error / 409 unpriced); `employer.test.ts` |
| Preview identical to the public job page | DONE `portal/employer/JobPreview.tsx` (React copy of the layout) |
| Checkout; cancel → "not completed", draft intact; success polls, CLEARS DRAFT | PARTIAL: cancel notice + draft kept, polling done (`post-job.tsx`, `portal/employer/checkout.ts`, `screens/jobs.tsx`); the draft is cleared only for free posts, never after a paid checkout |
| Webhook fulfilment idempotent, refuses mismatch | CHANGED-BY-PLATFORM: `onCheckoutPaid` by checkout id, price key must match (`server/payments-hooks.ts`); test |
| Paid → submissionTarget (trusted/auto live; else review) | DONE `server/board/lifecycle.ts`, `employer-orders.ts` (`settleListingOrder`) |
| Free posting: $0 order, no checkout | DONE `server/board/employer-orders.ts` (`startListing`); test |
| Full refund takes the listing down | DONE `server/payments-hooks.ts` `onRefund` → `refundListingOrder` (`employer-orders.ts`); test |
| `order-receipt`, `job-submitted` on payment; `job-approved` on auto-publish | DONE `server/board/employer-notify.ts` (`notifySettled`) |
| My jobs columns, stat cards, Expired past expiry | DONE `portal/employer/screens/jobs.tsx`, `OverviewPanel.tsx`, `server/board/employer-jobs.ts` (`effectiveStatus`) |
| Edit → re-review (conditional), keeps dates; rejected not editable/renewable | DONE `server/board/employer-routes.ts`, `employer-jobs.ts` (`EDITABLE`); test |
| Close as filled (again → 409) | DONE `server/board/employer-routes.ts` |
| Renew with tier picker; live → days added; expired/closed relisted; non-featured keeps featured | DONE `server/board/employer-orders.ts` (renew branch), `screens/jobs.tsx` |
| Renew/extend/approve reset `expiryReminderSentAt` | DONE renew `employer-orders.ts`, extend/relist `manage-jobs.ts`, approve `lifecycle.ts` (`publishJob`); test |
| Duplicate → wizard draft, ASKS before replacing an unfinished draft | PARTIAL: duplicate done (`screens/jobs.tsx`); it overwrites any draft without asking |
| Company editor: about ≤2000, HQ, https website + socials ≤300, name read-only | DONE `server/board/employer.ts` (`readCompanyProfile`) |
| Logo PNG/JPG/WebP ≤1 MB by first bytes, no SVG, old file deleted, 30/hour | DONE `server/board/employer-logo.ts` (`isLogoImage`, `LOGO_UPLOADS_PER_HOUR`) |
| Audit `company.update` with changed field names | DONE `server/routes/employer.ts` |
| Billing: own orders newest first, receipt, other company → 404 | DONE `server/board/employer-orders.ts`, `portal/employer/screens/billing.tsx`, `receipt.tsx` |
| Stripe `receiptUrl` link | CHANGED-BY-PLATFORM (`receiptUrl` column kept) |
| Employer area 404 in single-company | DONE `server/board/employer.ts`; test |
| Sign-in lands on `/employer` / `/admin` | CHANGED-BY-PLATFORM (`/dashboard` nav) |

## D. Admin

| Feature/behaviour | Status |
| --- | --- |
| Admin = `admin` role, others 404 | CHANGED-BY-PLATFORM: codenames in `server/permissions.ts`; `tests/integration/manage.test.ts` |
| Overview: revenue 30d/all, paid orders, pending, active, applications 30d, top 5 by views | DONE `server/board/manage-overview.ts` (capped reads, "1000+"), `portal/admin/OverviewPanel.tsx` |
| Moderation nav shows waiting count | MISSING (`portal/admin/routes.tsx` nav item has no count) |
| Queue FLAGGED FIRST then oldest; review page: preview + flagged / unverified / live-edit notes + employer history (… 5 recent) | PARTIAL: oldest-first queue, Flagged badge, live-edit notice, history counts + spend done (`server/board/manage-moderation.ts`, `screens/review.tsx`); no flagged-first order, no flagged/unverified notes on the review page, no 5 recent jobs |
| Review page 404 once decided | DONE `manage-moderation.ts` (`/:id` 404 unless `pending_review`; stale `seen` → 409) |
| Approve → live + `job-approved`; "Trust company"; live edit keeps dates | DONE `manage-moderation.ts`, `lifecycle.ts` |
| Reject: reason ≤500, `job-rejected` (skipped ownerless) | PARTIAL: done (`manage-moderation.ts`); no 3-character minimum (any non-empty reason) |
| One-click Stripe refund on reject | CHANGED-BY-PLATFORM: `refundNote` "refund in the platform dashboard" |
| `admin-job-review` to every admin once per entry into review | DONE `server/board/review.ts` (`notifyReviewers`), callers `employer-notify.ts`, `employer-routes.ts` |
| Moderation mode all/auto, audit, linked from Moderation page | DONE `manage-settings.ts`, `screens/settings-board.tsx`, link in `screens/moderation.tsx` |
| Admin jobs filters: status, category, featured, source, title/COMPANY search, 20/page, IN URL | PARTIAL: filters done (`server/board/manage-jobs.ts`); search is title only; filters are component state, not in the URL (`portal/admin/screens/jobs.tsx`) |
| Feature/stop, extend/relist, close, delete (applications + resume files) | DONE `server/board/manage-jobs.ts`; test |
| Free admin jobs, new ownerless company; locked to owner in single-company | DONE `server/board/manage-job-edit.ts` |
| Edit lock: PUT on paid/credit/free → 403 `employer_job_locked`; Edit hidden | DONE `manage-job-edit.ts` (lenient body parse, lock before checks), `screens/jobs.tsx`; test |
| "Run expiry now", "Run purge now" | DONE `manage-jobs.ts`, `manage-privacy.ts` |
| Overlapping run → 409 `task_running` | CHANGED-BY-PLATFORM: background lists with `concurrency: 1` (`background.json`) |
| Listing tiers 1–3: add, edit, deactivate (never delete), ≥1 active, days 1–120, featured | DONE `server/board/manage-tiers.ts`; test |
| Board currency + listing price | CHANGED-BY-PLATFORM: price from catalogue key; DONE `board_settings.currency` set in `screens/settings-board.tsx` (`PUT /manage/settings/currency`) |
| Branding: name, logo, colour (hex + PICKER), font, hero, footer links, LIVE PREVIEW, audit | DONE `screens/settings-branding.tsx` (picker + live preview); footer links ≤8 |
| Branding images raster only, ≤1 MB, own uploads | DONE `manage-settings.ts` (shares `employer-logo.ts` checks) |
| Board mode: owner company (existing or NEW), CONFIRM DIALOG listing effects, audit | DONE `manage-settings.ts` (`newCompanyName`), `screens/settings-board.tsx` (confirm dialog) |
| Admin applicants: job + status filters, notes, audited downloads, CSV | DONE `portal/applicants/ApplicantsScreen.tsx`, `server/routes/applications-manage.ts` |
| Privacy tool: lookup, delete all, delete one (404 if not that email), email only in POST bodies | DONE `server/board/manage-privacy.ts`, `screens/privacy.tsx` |
| Privacy audit stores a salted hash of the email | DONE `manage-privacy.ts` (HMAC with `jwtSecret`) |
| Audit log page with filters (action, entity type, id) | CHANGED-BY-PLATFORM: `/dashboard/activity` (`portal/screens/activity.tsx`); no filters, decision in MIGRATION.md (Release 2) |
| Email log: status + recipient filters, 50/page, error | DONE `server/board/manage-emails.ts`, `screens/emails.tsx` |
| Onboarding checklist | CHANGED (dropped in old app) |

## E. Emails, tasks, seed, tests

| Feature/behaviour | Status |
| --- | --- |
| 11 board templates | DONE `server/board/emails/templates.ts`, `email.ts` |
| employer-verify, password-reset, magic-link | CHANGED-BY-PLATFORM (account emails) |
| alert-confirm, alert-digest; `EmailTemplate` overrides | out (R2) |
| Variables escaped before Markdown; links absolute | DONE `server/board/emails/render.ts`; `tests/integration/board-email-slug.test.ts` (origin of the request URL, not forwarded headers) |
| Every email logged (sent / failed / skipped) | DONE `server/board/email.ts` (`email_logs`) |
| Employer email links → site home on a single-company board | PARTIAL: expiry emails skipped, new-applicant goes to staff; no general rule in `sendBoardEmail` (approve/reject emails still link to `/dashboard/employer/...`) |
| runExpiry: expire + `job-expired`, featured off, one `job-expiring` 3 days before, conditional, no employer emails in single-company, audit | DONE `server/board/tasks.ts`, `server/background.ts`; `tests/integration/board-tasks.test.ts` |
| runPurge: file first, conditional clear, row kept; stale uploads; old attempts | DONE `server/board/tasks.ts`; test |
| Expire hourly, purge daily | DONE `background.json` |
| Traffic trigger / task endpoint / `scheduled` | CHANGED-BY-PLATFORM (background jobs) |
| Seed per SPEC Defaults | DONE `prisma/seed.sql`, categories/tiers in `prisma/migrations/20261030114126_job_board` |
| Tests: pricing, expiry, slug uniqueness | DONE `tests/integration/employer.test.ts`, `manage.test.ts`, `board-tasks.test.ts`, `board-email-slug.test.ts` |
| Tests: JSON-LD (onsite, remote, no salary, expired); no cross-company applicant access | DONE `tests/json-ld.test.ts`, `tests/integration/applications.test.ts`, `employer.test.ts` |

## Security and system rules (old `CLAUDE.md`)

| Feature/behaviour | Status |
| --- | --- |
| Prisma only, tagged `$queryRaw`/`$executeRaw`; secrets server-only | DONE (grep: no `Unsafe`; `config.ownerSecret` in `server/board/email.ts`) |
| Guards on every route; employers own company only (404) | DONE `server/board/employer-routes.ts`, `applicants.ts`; tests |
| CSRF on mutations; sessions in DB 30 days | CHANGED-BY-PLATFORM (platform `csrf`, JWT + refresh) |
| IPs only as salted hashes | DONE `server/board/ip.ts` |
| Sanitizer allow-list, http(s)/mailto, `nofollow noopener noreferrer ugc` | DONE `lib/rich-text.ts` |
| Sanitize on write and again on read | DONE `lib/rich-text.ts` used by `employer.ts`, `public-shapes.ts` |
| Open-redirect-safe redirect after sign-in | CHANGED-BY-PLATFORM (`next=`) |
| Admin edit lock; single-company 404s | DONE (see C, D) |
| `/health`, `/settings/public`; `/dev/*` fakes | CHANGED-BY-PLATFORM (`/me` `board`, `/dashboard/components`, payments sandbox) |
| Domain events bus | out (R2) |

## Remaining gaps

Only PARTIAL / MISSING rows. Area, where the fix belongs, one-line fix.

2. **Theme before first paint** (A): `layouts/Base.astro`: an `is:inline` head script (hashed for the CSP) that applies `site:theme` before the body renders.
3. DONE **Paid checkout leaves the wizard draft** (C): `portal/employer/screens/jobs.tsx`: `clearDraft()` when `confirmCheckout` answers `paid` (and when the popup reports paid in `post-job.tsx`).
5. DONE **Filters not in the URL** (admin jobs DONE via validateSearch; applicants screen DONE): `portal/applicants/ApplicantsScreen.tsx` (status) and `portal/admin/screens/jobs.tsx` (all filters): `validateSearch` on the routes + `navigate({search})`.
6. ~~**Moderation queue** (D): `server/board/manage-moderation.ts`: order `[{flagged: 'desc'}, {id: 'asc'}]` (keyset on both); review page notes for flagged/unverified and the company's 5 recent jobs (`history`); nav count on the Moderation item (`portal/admin/routes.tsx`, a capped `pageCount`).~~ FIXED
7. ~~**Reject reason minimum** (D): `manage-moderation.ts` `rejectBody` + `screens/review.tsx` rule: 3–500 characters.~~ FIXED
8. ~~**Companies directory order** (A): `server/routes/companies.ts`: order by `activeJobCount desc, id` (keyset on both); home "Hiring now" from the same order (`server/routes/board.ts`).~~ FIXED (A)
9. ~~**Home latest workplace switch** (A): `pages/index.astro`: Any/Remote/On-site/Hybrid links to the latest list (`?workplace=`), read in `/board/home`.~~ FIXED (A)
10. ~~**/jobs mobile + location** (A): `pages/jobs/index.astro`: debounce (400 ms) submit on location input; mobile sheet button "Show N jobs" (N from the result); "See all N featured jobs" (N from `featuredMore`, a capped count).~~ FIXED (A)
11. DONE **Wizard step in URL + focus** (C): `portal/employer/routes.tsx` `validateSearch: {step}`, `post-job.tsx` navigates per step and focuses the step container.
12. DONE **Duplicate asks first** (C): `portal/employer/screens/jobs.tsx` `duplicate`: `useConfirm` when `loadDraft()` holds an unfinished draft.
15. DONE **Single-company email links** (E): `server/board/email.ts` `sendBoardEmail`: on a single-company board rewrite `/dashboard/employer/*` links to `/` (or skip employer templates).
16. ~~**Branding preview + picker** (D): `portal/admin/screens/settings-branding.tsx`: `<input type="color">` beside the hex field and a small live preview card.~~ FIXED
17. ~~**Board mode** (D): `screens/settings-board.tsx`: `useConfirm` listing the effects; `manage-settings.ts` accepts `newCompanyName` for a new owner company.~~ FIXED
18. ~~**Moderation mode link** (D): `screens/moderation.tsx`: a `<Link>` to the board settings screen in the `PageHeader`.~~ FIXED
19. ~~**Board currency** (D): `manage-settings.ts` + `screens/settings-board.tsx`: an ISO currency setting for min-salary/display, or record in MIGRATION that it is fixed by the seed.~~ FIXED
20. **Audit log filters** (D): decided: no filters in the template's activity screen (see MIGRATION.md); Release 2.
