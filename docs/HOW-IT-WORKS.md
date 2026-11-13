# How Talent Trail Hub works

A plain guide to this project for the owner and new developers. It is written from the code as
it was on 2026-10-30, during the move from the old TanStack app (`~/projects/talent-trail-hub-old`)
to the Astro platform template. Some parts were still being finished then (see the status in
[MIGRATION.md](MIGRATION.md)). When this guide and the code disagree, the code wins.

Other docs: [../AGENTS.md](../AGENTS.md) (the rules every developer and AI agent follows),
[MIGRATION.md](MIGRATION.md) (old app → new platform decisions), [PARITY.md](PARITY.md)
(feature checks against the old app), [GO-LIVE.md](GO-LIVE.md), `agent/<topic>.md` (platform
topic docs). Feature numbers like "F12" come from the old app's `docs/SPEC.md` and appear in code comments.

---

## 1. The big picture

Talent Trail Hub is a job board. Employers pay to post jobs. Candidates apply without an
account. Admins check jobs and run the board.

Everything is **one Astro project** running on **one Cloudflare Worker** (a small server
program run by the platform). It has these layers:

1. **Astro pages** (`src/pages/`). Each file is one URL. Some are **prerendered** (built once
   into a plain HTML file), the others are **SSR** (server-side rendered on every request).
2. **The Site API** (`/site-api/*`). A small backend built with **Hono** (a light web
   framework) in `src/server/app.ts`. It is the ONLY backend: validation, permission checks
   and database work all live here. Pages only show what it answers.
3. **Prisma** (a library that turns database tables into typed TypeScript objects), defined in `prisma/schema.prisma`.
4. **The Site Database**: a Postgres database the platform gives this site.

Beside the pages there is **the dashboard** at `/dashboard/*`: a React app (a "SPA", single-page
app) in `src/portal/`. Employers and admins work there.

```
 browser ──► Astro page (SSR) ──in-process call──► Hono /site-api ──► Prisma ──► Site Database
 browser ──► /dashboard (React SPA) ──── fetch ───► Hono /site-api        └──► platform services
```

**In-process** means an SSR page calls the Hono app directly inside the same Worker, with the
visitor's cookies, without a network trip (`backend()` / `pageContext()` in `src/server/`).
The dashboard calls the same API from the browser with `fetch` (`src/portal/api.ts`).

**Which pages are which** (from the `prerender = true` lines):

| Prerendered (static HTML) | SSR (rendered per request) |
|---|---|
| `/about/`, `/privacy/`, `/terms/`, `/saved/`, `/blog/*`, `/account/*` (login, register, forgot, reset, verify, confirm-email), `/robots.txt`, `/rss.xml` | `/` (home), `/jobs/`, `/jobs/<slug>/`, `/companies/`, `/companies/<slug>/`, `/pricing/`, `/post-a-job/`, `/signup/`, `/checkout/`, `/thanks/`, `/sitemap.xml`, `/dashboard/*` (the host page of the React app), `/portal/*` (redirects to `/dashboard`) |

`/saved/` is static: saved jobs live in the visitor's browser and are filled in by a script.
`/api/*` belongs to the platform. Never add routes there.

---

## 2. People and permissions

There is one `users` table, owned by this site (`src/platform/auth/`). What a person may do
comes from their **roles**, and roles hold **permissions** (named "codenames").

| Who | How they get there | What they can do |
|---|---|---|
| **Guest / candidate** | No account needed | Browse and search jobs and companies, save jobs in this browser, apply with a resume. Limit: 5 applications per IP address per hour; one application per email per job (409 `already_applied`). |
| **Employer** | Any signed-in user with a **verified email** (`requireVerified`) | The employer area: post and pay, own jobs (edit, close, renew, duplicate), own applicants, company profile and logo, billing and receipts. One user owns at most ONE company (`companies.owner_user_id` is unique). Other companies' data answers **404**. |
| **Admin** | The `admin` role, which holds the board's codenames | The board's admin screens under `/dashboard/manage/...` |
| **Owner** | Made on the first "View as admin" click in the platform dashboard, with the `owner` role (`*`, every permission); no email or password on the site | Everything, plus users and roles. Signs in only in one click from the platform dashboard ("View as admin" / "Open live portal"). |

The admin codenames are declared once, in `src/server/permissions.ts` (`CATALOGUE`):

| Codename | Ability flag (UI) | Unlocks |
|---|---|---|
| `site:job:moderate` | `moderateJobs` | Moderation queue, approve, reject; receives review emails |
| `site:job:manage` | `manageJobs` | All jobs: free admin posts, feature, extend, close, delete, "Run expiry now" |
| `site:applicant:read` | `readApplicants` | Every applicant and resume (admin downloads are audited) |
| `site:privacy:manage` | `managePrivacy` | Candidate data lookup and delete, "Run purge now" |
| `site:board:settings` | `manageBoard` | Listing tiers, free posting, branding, board mode, moderation mode |
| `site:board:reports` | `readBoardReports` | Overview numbers, email log |

**Admins cannot edit an employer's job content** (source `paid`, `credit` or `free`): the API
answers 403 `employer_job_locked` (`src/server/board/manage-job-edit.ts`). To get it changed, they reject it with a reason.

**How it is checked.** On the server, every route runs guards in this order:
`validator → withViewer → requireAuth → requirePermission('site:…') → withDb`
(`src/platform/guards.ts`). Applicants go through a "scope" (`applicantScope` in
`src/server/board/applicants.ts`): `all` for `site:applicant:read`, the own company for an
employer, otherwise nothing. In the dashboard, `/site-api/me` returns `abilities` that only
decide what the menu SHOWS; the server checks again on every call.

---

## 3. Folder map

| Folder | What lives there | Yours? |
|---|---|---|
| `src/pages/` | One file per URL (public pages, `/account/*`, the dashboard host page, the `/site-api` catch-all `site-api/[...path].ts`) | yours |
| `src/layouts/`, `src/components/` | Page layout (`Base.astro`: head, header, footer, SEO), shared pieces; `components/apply/` is the apply form, `components/payments/` the buy parts | yours |
| `src/server/app.ts` | Builds the Hono app and mounts every route | yours |
| `src/server/routes/` | API endpoints by area: `jobs`, `companies`, `board`, `applications` (+ `applications-manage`), `employer`, `manage`, `checkout`, `site` | yours |
| `src/server/board/` | The board's logic: settings, public filters, lifecycle, orders, moderation, emails (`email.ts` + `emails/templates.ts`), tasks, `manage-*.ts` admin routes, `employer-*.ts` | yours |
| `src/server/permissions.ts` | The permission catalogue (section 2) | yours |
| `src/server/payments-hooks.ts`, `background.ts` | What happens when money moves; background job handlers | yours |
| `src/portal/` | The dashboard: `routes.tsx` (shell, nav, routes), `employer/`, `admin/`, `applicants/`, `board/JobForm.tsx` (job fields form shared by employer and admin), `screens/` (overview, account, users, roles, activity), `ui/` (the one UI kit) | yours |
| `src/lib/` | Shared helpers (browser-safe): `board.ts` (fixed sets, LIMITS, `RESUME_RETENTION_DAYS`), `rich-text.ts`, `markdown.ts`, `slug.ts`, `seo.ts`, `json-ld.ts`, `types-*.ts` (API shapes per area) | yours |
| `src/content/`, `src/styles/` | Site words (`site.ts`), blog Markdown (kept, out of scope); design tokens and classes | yours |
| `prisma/` | `schema.prisma`, `migrations/` (forward-only SQL), `seed.sql` (fake board data) | yours |
| `background.json` | The schedules of the background jobs | yours |
| `tests/` | Unit tests; `tests/integration/` runs against a real test database | yours |
| `src/platform/` | **Managed by the platform**: config, guards, auth, files, payments, background, sanitizer | never edit |
| `docs/agent/` | **Managed**: the platform topic docs | never edit |
| `src/generated/` | Prisma client made by `prisma generate` | never edit |

`npm run platform -- upgrade` replaces the managed folders; that is how security fixes arrive.

---

## 4. Platform services

The platform gives the site these services. Their code is in `src/platform/` (describe and use, never change).

- **Auth** (`src/platform/auth/`, pages in `/account/*`). Sign-up with email confirmation,
  sign-in, password reset, two-step sign-in, sessions in secure cookies, rate limits. Sign-up
  rules: `src/server/auth-settings.ts`. Actions are written with `audit()` and shown at `/dashboard/activity`.
- **Files** (`src/platform/files.ts`). The browser uploads straight to storage (never through the
  Worker): the route asks `createUpload()`, the browser PUTs the bytes, the route checks with
  `completeUpload()`. **Resumes are private** (shown via a 10-minute download link,
  `LINK_SECONDS = 600`); **logos are public**.
- **Payments** (`src/platform/payments.ts`, `docs/agent/payments.md`). The platform's checkout.
  Prices live in the platform catalogue, made in the editor with `npm run platform -- prices add …`.
  Signed payment events call the hooks in `src/server/payments-hooks.ts`. Sandbox while building.
- **Background jobs** (`src/platform/background.ts`). Handlers in `src/server/background.ts`,
  schedules in `background.json`. No timers in code.
- **Emails, two kinds:**
  - **Account emails** (confirm, reset, sign-in codes) are sent by the platform for the site.
  - **Board emails** (job submitted, approved, rejected, expiring, expired, new applicant,
    application confirmation, shortlisted, rejected, admin review, order receipt) go through
    `sendBoardEmail` in `src/server/board/email.ts`. They are sent with Resend when the owner adds
    the `RESEND_API_KEY` secret (sender: the `EMAIL_FROM` secret); without it they are only logged
    as `skipped`. Every one writes an `email_logs` row. It never throws, so a failed email never undoes a payment or an application.

---

## 5. Key flows, step by step

### 5.1 Post a job and pay (F10, F12, F25)
1. A guest opens `/post-a-job/` and is sent to `/account/register/?next=…` or login. (The old
   `/signup/` redirects to register in marketplace mode.) After sign-up they confirm their email.
2. The wizard is at `/dashboard/post-a-job` (`src/portal/employer/screens/post-job.tsx`). The
   draft is kept in the browser (`src/portal/employer/draft.ts`).
3. Submit calls `POST /site-api/employer/post` (`src/server/routes/employer.ts`). It checks the
   job fields, creates the company on the first post (unique slug), and creates or reuses the
   job with status `pending_payment`. The browser sends a **tier id only**: price, days and featured come from the server.
4. `startListing()` (`src/server/board/employer-orders.ts`) creates a `listing_orders` row.
   Free posting ($0) is settled at once. A paid tier starts the platform checkout for the tier's
   catalogue price (`listing_tiers.price_key`); the amount charged is the catalogue's.
5. After paying, the platform sends a signed event to `onCheckoutPaid` (and `/thanks/` confirms
   too, so a hook may run twice; it is safe to). `settleListingCheckout` finds the listing order
   **by checkout id** (never by browser data) and `settleListingOrder` marks it paid in one
   transaction, once.
6. The job then goes **live** (`publishJob`: `expiresAt = now + durationDays`, featured for the
   whole period if the tier includes it) or into **review** (`pending_review`), decided by
   `submissionTarget` in `src/server/board/lifecycle.ts`: live when moderation mode is `auto`
   or the company is trusted. Emails go after the commit (receipt, submitted, reviewer alert).
7. **Renew** is the same with `kind = 'renew'`: one more period from now.
8. **Refunds** are made in the platform dashboard (no refund API). `onRefund` marks a FULL
   refund `refunded` and takes the listing down: in review → `rejected`, live → `closed`.

### 5.2 Moderation (F20)
1. A job in review appears at `/dashboard/manage/moderation` (oldest first). Every user whose
   roles grant `site:job:moderate` gets an `admin-job-review` email (`notifyReviewers`, `src/server/board/review.ts`).
2. **Approve** publishes it (`publishJob`); an approved edit of a live job keeps its dates.
   The employer gets `job-approved`.
3. **Reject** needs a reason; status `rejected`, employer gets `job-rejected`. If it was paid,
   the screen says to refund the order in the platform dashboard.
4. Both are written to the audit log (`src/server/board/manage-moderation.ts`).
5. **Employer edits are reviewed too** (`jobs.needs_review`). Saving an edit (`PUT /site-api/employer/jobs/:id`,
   `src/server/board/employer-routes.ts`) sets it, unless the board would publish at once and the job
   is live; a live job then goes back to `pending_review` and the reviewers are alerted. Renewing an edited
   job follows `submissionTarget` again (`employer-settle.ts`). Only an approval clears it, or a settle that
   publishes directly. While it is set, admins cannot feature or extend the job (409 `needs_review`);
   All jobs shows "Changes in review".

### 5.3 Apply with a resume (F4, F36)
1. On `/jobs/<slug>/` the apply form (`src/components/apply/`) asks `POST
   /site-api/applications/resume` for a private upload, the browser PUTs the file, then
   `POST /resume/complete` confirms it. A `resume_uploads` row with a random token tracks it.
2. `POST /site-api/applications/jobs/:slug/apply` sends the form with the token and the
   consent. A filled honeypot field or more than 5 per IP-hour is silently "accepted" and dropped.
   Jobs that apply by URL or email only count the click (`/click`). An employer cannot apply to their own job.
3. The candidate gets `application-confirmation`; the employer gets `new-applicant` (on a
   single-company board, or a company without an owner account, the staff with applicant access get it).
4. Employers see applicants at `/dashboard/employer/jobs/<id>/applicants`, admins at
   `/dashboard/manage/applicants`: status, notes, CSV export, 10-minute resume links. Moving to
   shortlisted or rejected emails the candidate once (`status_emailed_at`).

### 5.4 Expiry and purge (background jobs)
`background.json` sets two schedules; both call functions in `src/server/board/tasks.ts`, which
also back the admin "Run now" buttons. Each change is claimed with a conditional update, so two
runs at once never send an email twice.
- **`board-expiry`, every hour** (`runExpiry`): jobs past `expiresAt` become `expired` (email
  `job-expired`), featured flags past `featuredUntil` are removed, and a `job-expiring` reminder
  goes 3 days before (`REMINDER_DAYS`). Public pages also check `expiresAt > now`, so a late run never shows an expired job.
- **`board-purge`, daily 03:30 UTC** (`runPurge`): resumes older than `RESUME_RETENTION_DAYS`
  (180) are deleted (file first, then the fields), unattached uploads older than a day are swept, old `board_attempts` rows are removed.
Runs that changed something are written to the audit log.

### 5.5 Single-company mode (F39)
The admin sets it at `/dashboard/manage/settings/board` (`board_settings.board_mode` +
`owner_company_id`). It is on ONLY when an owner company is set (`isSingleCompany` in
`src/server/board/settings.ts`); otherwise the board stays a marketplace. When on:
- Public pages show only the owner company's jobs (`publicJobWhere` in `src/server/board/public.ts`, used by every public job read).
- The whole employer API answers 404 (`employerArea` in `src/server/board/employer.ts`),
  `/signup/` answers 404, and employer menu items are hidden (`/me` returns `board.singleCompany`).
- New-applicant emails go to the staff instead of an employer.
- Per page: `/` shows the owner company (its name in the description, its JSON-LD) without the
  companies list or the employer call to action; `/jobs/` lists only its jobs; `/companies/<slug>/`
  shows only the owner company (others 404); `/companies/`, `/pricing/`, `/post-a-job/` and
  `/signup/` answer 404. Header and footer links marked `data-marketplace-only` are hidden (on
  prerendered pages such as `/about/` by the brand stylesheet, `brandCss` in `src/server/board/brand.ts`),
  and `/sitemap.xml` leaves out companies, pricing and post-a-job.

---

## 6. The data model

The platform's tables (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`,
sessions and codes, `audit_events`, `orders`, `memberships`, `payment_events`, `job_deliveries`)
are managed by the template. The board's own tables:

| Table | What it holds | Links |
|---|---|---|
| `board_settings` | ONE row (`id = 1`): name, logo, colour, font, hero text, footer links, currency, moderation mode, free posting, board mode | `owner_company_id` → `companies` |
| `companies` | A hiring company; `slug` is its URL and never changes; trusted / blocked flags; `active_job_count` | `owner_user_id` → a user (unique, no foreign key: it outlives the account) |
| `categories` | Job categories | many `jobs` (cannot be deleted while used) |
| `jobs` | A job: content, location, salary, apply method, `status`, `source`, featured and listing dates, counters, `needs_review` | → `companies`, `categories`, `listing_tiers`; `created_by` → a user (no foreign key) |
| `tags`, `job_tags` | Up to 5 lower-case tags per job | many-to-many between `jobs` and `tags` |
| `applications` | A candidate's application, resume file id, status, private notes, consent | → `jobs` (deleted with the job); one per email per job |
| `resume_uploads` | An upload before / after it is attached | `application_id` (unique) |
| `listing_tiers` | What a post costs and gives: catalogue `price_key`, days, featured | used by `jobs` and `listing_orders`; deactivated, never deleted |
| `listing_orders` | What an employer bought for a job (`new` or `renew`); copies the tier's terms at order time | → `companies`, `jobs`, `listing_tiers`; `checkout_id` → the platform checkout and the `orders` row |
| `email_logs` | Every board email: template, recipient, `sent` / `failed` / `skipped` | none |
| `board_attempts` | Rate-limit ledger (hashed IPs only) | none |

**A job's life:** `draft` → `pending_payment` → `pending_review` or `published` → `expired`
or `closed` (or `rejected`). Public only when `published` AND `expires_at` is in the future
AND the company is not blocked.

Ids are whole numbers (`Int` autoincrement); places where an id would leak use a random token.

**Migrations** (`prisma/migrations/`, forward-only): the template's seven (`init` … `payments`), then the
board's `job_board` (drops the demo job columns, adds the tables, the Standard tier and categories),
`job_featured_sweep_index`, `job_needs_review` and `board_query_indexes`.

---

## 7. How to add a feature safely

1. **Read [AGENTS.md](../AGENTS.md) first**, then the topic doc for the work (`agent/ui.md`,
   `agent/database.md`, `agent/site-api.md`, `agent/security.md`, …). Its "Recipes" section is the checklist:
   - a Site API route: "A Site API route" → `agent/site-api.md`
   - a dashboard screen: "A portal screen" → `agent/ui.md` (queries, screen, route, nav item)
   - an admin-only feature: "An admin-only feature" → one `CATALOGUE` entry in `src/server/permissions.ts`
   - a public list + detail: "A server-rendered list + detail" (like `/jobs`)
   - a new table or column: "A new table (model)" → a NEW migration, never edit an old one
   - uploads: "A file upload" → `agent/files.md`; selling: "Something to sell" → `agent/payments.md`
   - later or scheduled work: "Something later or on a timetable" → `agent/background-jobs.md`
2. **Put logic in the Site API**, not in pages. Validate every input; never take ids, roles,
   owners or prices from the browser.
3. **Every public job read uses `publicJobWhere`**; every job going live uses `publishJob`
   (`src/server/board/lifecycle.ts`), so dates and featured rules stay the same everywhere.
4. **Gate on codenames, never role names**; employers reach only their own company (404 otherwise).
5. **Build screens from the UI kit** (`src/portal/ui/`) and follow the button and form rules in AGENTS.md.
6. **Never edit** `src/platform/`, `docs/agent/` or `src/generated/`.
7. **Before calling it done:** `npm run build` and `npm test` pass, the Preview shows it, and
   `agent/security.md`'s checklist holds. Then the owner publishes from the editor.
