# Go-live runbook (owner)

How to run Talent Trail Hub on your machine, switch on what it needs in the platform dashboard,
and publish it. Short steps, in order. Rules for code changes are in `AGENTS.md`; background
in `docs/MIGRATION.md`.

## 1. On your own machine (optional, for trying it out)

You need Node 22.12 or newer and `openssl`.

1. Install the packages (exactly what the lockfile says):
   ```sh
   npm ci
   ```
2. Start a local database (Prisma Postgres, runs on your machine):
   ```sh
   npx prisma dev --name tth-local     # leave it running; it prints connection strings
   npx prisma dev ls                   # lists your local databases and their ports
   ```
   Use the plain `postgres://…localhost:<port>/…` (TCP) string it shows.
3. Make your settings file and fill it in. `.env` stays on your machine; never commit it.
   ```sh
   cp .env.example .env
   openssl rand -base64 48            # copy the output into JWT_SECRET
   ```
   | Name | What to put |
   | --- | --- |
   | `DATABASE_URL` | the local database string from step 2 |
   | `JWT_SECRET` | the random string from `openssl` (32+ characters) |
   | `SITE_URL` | the site's address from the platform (Settings); empty skips branding and relayed emails |
   | `SITE_KEY` | optional: the Site Key, so confirmation and reset emails are really sent |
   | `SITE_OWNER_EMAILS` | optional: your email. Empty = the first account to confirm its email becomes owner |
4. Create the tables, then add the demo data (fake companies, jobs and applications; local or
   Preview only, never live):
   ```sh
   npx prisma migrate deploy
   npx prisma db seed
   ```
5. Run it:
   ```sh
   npm run dev                        # open http://localhost:4321
   ```
   Background jobs run right away in this process; schedules do not tick locally.
   Payments here are always test payments.

Inside the editor you do not need any of this: the Preview already has its own database,
secret and Site Key.

## 2. In the platform dashboard (once)

1. **Site Database: turn it on** (the site's Database tab). Do this FIRST: a version with
   migrations is refused until the site has a database. Without it the board answers
   "the Site Database is not enabled".
2. **Storage: add a storage pack, then "Turn on"** (the app's Storage tab). Needed for
   resumes (kept private) and company logos (public). Without it uploads fail with
   "needs a pack" or "storage off".
3. **Payments** (the site's Payments tab). Nothing to connect at first: the live site takes
   TEST payments and shows a test badge until you connect a live gateway. Leave it in sandbox
   for your first checks (section 6); connect the live gateway only after they pass. The site
   then switches to real payments by itself.
4. **Secrets for board emails** (site secrets, added by you; the code only reads them):
   | Secret | Value |
   | --- | --- |
   | `RESEND_API_KEY` | your Resend API key |
   | `EMAIL_FROM` | the sender, e.g. `Board <jobs@your-domain>`, on a domain verified in Resend |

   Add them in the `production` environment for the live site (the `staging` one is what the
   Preview reads). Without `RESEND_API_KEY`, board emails are only logged as "skipped".
   Without `EMAIL_FROM`, Resend's test sender is used, which only delivers to your own Resend
   address. Account emails (confirm, reset, sign-in codes) are always sent by the platform;
   they need neither secret.

## 3. Listing tier prices

The price a company pays comes from the site's price catalogue, never from the page. Each tier
in the admin names a catalogue **key**.

1. In the editor terminal, create the price (sandbox first; it reaches the live account by itself):
   ```sh
   npm run platform -- prices add --key listing-standard-30 --name "Standard listing" \
     --amount-cents 9900 --currency USD --interval one_time
   npm run platform -- prices          # check: mode, readiness, every price
   ```
   Add one per tier you want (e.g. a featured one with its own key). A price never changes:
   for a new amount, make a NEW key and archive the old one in the dashboard.
2. In the admin, open **Listing tiers** (`/dashboard/manage/tiers`). The board starts with a
   "Standard" tier on the key `listing-standard-30`. For each tier pick its catalogue key, the
   number of days and whether it is featured. Create the catalogue price (step 1) before you
   pick its key; the amount charged is always the catalogue's.
3. Optional: turn **Free posting** on in the same screen; posting then skips checkout.

## 4. Publish

In the editor, type "publish". The platform then runs:

| Step | What happens |
| --- | --- |
| Prepare | checks the project is an Astro site it can deploy |
| Build | `npm ci`, then `npm run build` |
| Migrate | applies new database migrations to the LIVE database; if one fails, the old version keeps serving |
| Deploy | the new version goes live; the background schedules in `background.json` are set |

- **The first publish asks for approval.** The `job_board` migration removes the template's old
  demo job columns (location, company text, description, apply URL…) and replaces them with the board's
  tables. Anything that drops a column waits for your OK. On a new site there is nothing to
  lose: approve it.
- Schedules that start working after it: expire jobs and featured listings, and send expiry
  reminders, every hour; delete resumes past retention (180 days) daily at 03:30 UTC. You can
  see, pause or "run now" them in the Jobs tab.
- Rollback = redeploy an earlier deployment. Database changes stay applied.
- Demo data never goes live: do not run `npx prisma db seed` against the live database.

## 5. The admin (you)

- Your account already exists on the live site, made by the platform for the account owner's
  email, with the `owner` role and no password. Do not create another one.
- **Sign in:** go to `/dashboard`, enter your email, type the 6-digit code you get by email
  (10 minutes, one use). Or one click: "Open live portal" on the app's page in the platform
  dashboard (in the editor Preview: the shield in its bar).
- A password and two-step sign-in are optional: set them in the dashboard under **Your account** →
  Security (`/dashboard/account?tab=security`).
- **Make someone else an admin:** they sign up on the site first; then in **Users**
  (`/dashboard/users`) give them the `admin` role. Admins can moderate, manage jobs, read
  applicants, run the privacy tool and change board settings.
- Employers need no special role: any signed-in person with a confirmed email can create one
  company and post jobs.

## 6. First-day checklist (on the live site, still in sandbox)

- [ ] **Branding** (`/dashboard/manage/settings/branding`): name, logo, colours.
- [ ] **Moderation mode** (`/dashboard/manage/settings/moderation`): "Review every job" (trusted
      companies skip the queue) or "Publish at once".
- [ ] **Post a test job end to end:** sign up as a test employer in another browser, confirm
      the email, create the company (with a logo), post a job, pick a paid tier and pay with
      card `4242 4242 4242 4242`, any future date, any CVC.
- [ ] The order shows as paid in the test employer's **Billing** (`/dashboard/employer/billing`,
      with its receipt), and an `order-receipt` email is in the Email log.
- [ ] **Approve it** in **Moderation** (`/dashboard/manage/moderation`) when moderation is on;
      check it appears on `/jobs/`.
- [ ] **Apply** to it as a visitor (signed out) with a small PDF resume; the employer sees the
      applicant at `/dashboard/employer/jobs/<id>/applicants` and can download the resume.
- [ ] **Emails:** open **Email log** (`/dashboard/manage/emails`). Every board email should be
      "sent". "Skipped" means `RESEND_API_KEY` is missing; "failed" usually means `EMAIL_FROM`
      is on an unverified domain.
- [ ] **Run expiry now** in **All jobs** (`/dashboard/manage/jobs`) and **Run purge now** in
      **Candidate data** (`/dashboard/manage/privacy`): both finish without an error.
- [ ] **Board mode** (`/dashboard/manage/settings/board`): keep "Marketplace" for many
      employers, or choose "One company" and pick (or create) that company: the employer area,
      `/pricing/`, `/post-a-job/`, `/signup/` and `/companies/` are then gone (404).
- [ ] Reject or refund test: refunds are made in the platform dashboard (Payments), not in the
      board; a refunded order is marked refunded on the board.
- [ ] `/sitemap.xml` and `/robots.txt` show the live address.
- [ ] All good: connect the live payment gateway (section 2, step 3).

## 7. What changed from the old app

| Old app | Now |
| --- | --- |
| Stripe keys + webhook secret in env | built-in payments; no keys, sandbox until you connect a live gateway |
| Prices typed in the admin | prices in the catalogue (`npm run platform -- prices add`); tiers pick a key |
| One-click refund on reject | refund in the platform dashboard (Payments) |
| `AUTH_SECRET`, `IP_HASH_SALT`, `EZY_SITE_URL` | `JWT_SECRET` (also keys the IP hashes), `SITE_URL`, set by the platform when live |
| `npm run seed:admin` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` | owner account made by the platform; 6-digit code or one click |
| `/admin/*`, `/employer/*`, `/login`, `/signup` | `/dashboard/manage/*`, `/dashboard/employer/*` + `/dashboard/post-a-job`, `/account/*` (`/signup/` redirects to register) |
| Cron triggers, `TASKS_SECRET`, traffic-triggered tasks | platform background jobs (`background.json`), Jobs tab |
| Storage and email "ask the company" | Storage pack (platform files); Resend via your `RESEND_API_KEY` |
| Migrations run by hand | Publish runs them; destructive ones wait for your approval |
| `wrangler` config | none: the platform writes the deploy config |
