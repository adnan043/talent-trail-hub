# Talent Trail Hub: User Guide

Talent Trail Hub is a job board. **Employers** pay to post jobs, **candidates** apply without an
account, and **admins** check jobs and run the board.

This guide has two parts: [Employer guide](#part-1-employer-guide) and
[Admin guide](#part-2-admin-guide). Both work in the **dashboard** at `/dashboard`.

> What you see in the sidebar depends on who you are. If a menu item is missing, your account does
> not have that permission. Ask an admin.

---

## Part 1: Employer guide

### 1.1 Create your account
1. Open **Post a job** in the top menu (`/post-a-job/`).
2. Choose **Register**, enter your email and a password, and submit.
3. Open the confirmation email and click the link. **You must confirm your email before you can
   post.**
4. Sign in at `/account/login/`. You can turn on two-step sign-in and manage your devices under
   **Your account** in the dashboard.

### 1.2 Set up your company
Go to **Hiring → Company profile**.

| Field | Notes |
|---|---|
| Company name | Becomes your company page address (`/companies/<name>/`). **It cannot be changed later.** |
| Website | Optional. Full link starting with `https://`. |
| Location | Optional, e.g. "Berlin, Germany". |
| About the company | Optional. Up to 2,000 characters. Simple Markdown works. |
| Logo | PNG, JPG or WebP, up to 1 MB. SVG is not accepted. |

Each account owns **one company**. The company is created the first time you post a job.

### 1.3 Post a job
Go to **Hiring → Post a job**. The form is a short wizard. Your progress is saved in your browser, so
you can leave and come back.

1. **Your company**: fill in or confirm the details above.
2. **The job**:
   - Title (up to 100 characters).
   - Description (200 to 10,000 characters, simple Markdown).
   - Category, employment type (full-time, part-time, contractor, temporary, intern) and workplace
     (on-site, hybrid, remote).
   - Location, salary (optional, with period: hour, day, week, month or year).
   - Up to 5 tags, each up to 30 characters.
   - **How people apply**: on the site (with a resume), by a link, or by email.
3. **Choose a listing**: each listing has a price, a number of days live, and may include
   **Featured** placement (pinned on the first page of Find jobs and on the home page). The price
   is set by the board, not by your browser.
4. **Pay**: pick a payment method and complete checkout. A free listing is activated right away.

### 1.4 What happens after you submit
A job moves through these statuses:

| Status | Meaning |
|---|---|
| Draft | Saved, not submitted. |
| Pending payment | Waiting for payment. |
| In review | Waiting for an admin to approve it. |
| Live (published) | Visible to everyone until it expires. |
| Rejected | An admin declined it. You are emailed the reason. |
| Expired | The listing period ended. |
| Closed | Closed by you or an admin. |

- Depending on the board's moderation setting, a job goes **live immediately after payment** or
  **waits for review**. Trusted companies may skip review.
- You get emails for: job submitted, approved, rejected, **expiring soon (3 days before)** and
  expired, plus a receipt for each payment.
- **Editing a live job** sends it back to review, so changes are checked before they show.

### 1.5 Manage your jobs
Go to **Hiring → My jobs**. For each job you can:
- **Edit** the details.
- **Close** it when the position is filled.
- **Renew** it for another listing period (this is a new payment).
- **Duplicate** it to start a similar posting.
- Open its **Applicants**.

### 1.6 Review applicants
From **My jobs**, open a job's **Applicants**.
- Each applicant shows name, email, cover note and **resume** (PDF or DOCX, up to 5 MB).
- Resume links are private and **expire after 10 minutes**; open the resume again to get a fresh link.
- Set a status: **New → Reviewed → Shortlisted** or **Rejected**. Moving someone to Shortlisted or
  Rejected **emails the candidate once**.
- Add **private notes** (up to 5,000 characters). Candidates never see them.
- **Export to CSV** to use the list elsewhere.

You are emailed when a new applicant applies. For jobs that apply by link or email, only clicks are
counted; there are no applicant records.

### 1.7 Billing
**Hiring → Billing** lists your orders and receipts. **Refunds** are not self-service: contact the
board's admin.

### 1.8 Good to know
- Candidates can apply to a job **once per email**. You cannot apply to your own job.
- Resumes are **deleted automatically 180 days** after the application.
- You only ever see your own company's jobs and applicants.

---

## Part 2: Admin guide

### 2.1 Signing in
The admin account already exists; it is created from the owner email address.
- Go to `/dashboard`. Enter your email and the **6-digit code** emailed to you, **or** use the
  one-click sign-in from the platform dashboard ("Open live portal").
- A password and two-step sign-in are optional; set them under **Your account**.
- Other admins are added by the owner in **Users** (assign the **admin** role).

### 2.2 What each menu item does
Items appear only if your role has the permission.

| Menu | Permission | Use it to |
|---|---|---|
| **Overview** | Reports | See board numbers at a glance. |
| **Moderation** | Moderate jobs | Approve or reject jobs waiting for review. Shows a badge with the waiting count. |
| **All jobs** | Manage jobs | Find, filter, post, feature, extend, close or delete any job. |
| **Applicants** | See all applicants | See every applicant and resume on the board. |
| **Listing tiers** | Board settings | Set what a listing costs and includes. |
| **Candidate data** | Delete candidate data | Look up or erase a candidate's data. |
| **Email log** | Reports | See every board email and whether it was sent. |
| **Branding** | Board settings | Name, logo, colour, hero text, footer links. |
| **Board mode** | Board settings | Marketplace or single-company board. |
| **Moderation mode** | Board settings | Review every job, or publish automatically. |
| **Users / Roles / Activity** | Owner or granted | Manage accounts, roles and permissions, and see the audit log. |

### 2.3 Moderate jobs
1. Open **Moderation**. The oldest job waiting is first. Reviewers also get an email when a job needs review.
2. Open a job to read it exactly as it will appear.
3. **Approve** to publish it (the employer is emailed), or **Reject** with a reason (required, up to
   500 characters; the employer is emailed the reason).
4. If you reject a job that was **paid**, refund the order in the platform dashboard. Refunds are not
   done inside this app.

Both actions are recorded in **Activity**.

### 2.4 Manage all jobs
**All jobs** can be filtered by status, category, featured and source, plus search.
- **New job**: post a free job as admin (no payment, you can edit it later).
- **Feature** a job to pin it, **Extend** its end date, **Close** it, or **Delete** it.
- **You cannot edit the content of an employer's job.** If something is wrong, reject it with a reason
  and the employer fixes it.
- A job whose edits are still in review cannot be featured or extended until it is approved.
- **Run expiry now** closes expired jobs immediately. This also runs automatically every hour.

### 2.5 Applicants
**Applicants** shows every application. Filter by status or job. Resume downloads work the same way
as for employers (10-minute links) and **every admin download is logged**.

### 2.6 Listing tiers
**Listing tiers** control what employers can buy: name, days live, whether it is featured, and the
price.
- Up to **3 active tiers**, up to **120 days** each.
- Prices come from the platform catalogue. To add a paid price, create it in the editor (
  `npm run platform -- prices add …`), then attach it to a tier.
- Old tiers are **deactivated, never deleted**, so past orders keep their terms.
- Turn on **free posting** to let employers post at no cost.

### 2.7 Board settings
- **Branding**: name, logo, colour, font, hero text and footer links. Changes show right away, with no
  republish.
- **Board mode**:
  - **Marketplace** (default): many companies post jobs.
  - **Single company**: choose one owner company. The public site then shows only its jobs, and
    Companies, Pricing, Post a job and employer sign-up are hidden. Applicant emails go to staff.
- **Moderation mode**: **All** (every job is reviewed) or **Auto** (jobs go live after payment).
  Trusted companies skip review either way.

### 2.8 Candidate data (privacy)
**Candidate data** looks up an email address and can delete that person's applications, resumes and job
alerts. Use it for erasure requests. **Run purge now** removes resumes older than 180 days; this also
runs daily automatically.

### 2.9 Email log
Shows every board email (template, recipient, and `sent` / `failed` / `skipped`). Emails show as
`skipped` until the owner adds the mail key (`RESEND_API_KEY`, with `EMAIL_FROM` as the sender).

### 2.10 Users, roles and activity (owner)
- **Users**: invite, disable or change the roles of accounts.
- **Roles**: choose which permissions each role has. Give a person only what they need.
- **Activity**: the audit log of who did what and when.

---

## For candidates (quick reference)
- Browse and search at **Find jobs** (`/jobs/`); no account is needed.
- **Save** jobs in your browser and see them at **Saved jobs**.
- To apply, upload a **PDF or DOCX resume (up to 5 MB)** and accept the consent. You get a confirmation
  email, and later an email if you are shortlisted or rejected.

## Troubleshooting

| Problem | What to do |
|---|---|
| I can't post a job | Confirm your email first. Check the confirmation email and spam folder. |
| A menu item is missing | Your role lacks that permission. Ask an admin or the owner. |
| My job is not visible | It may be in review, unpaid, rejected or expired. Check its status in **My jobs**. |
| A resume link stopped working | Links last 10 minutes. Reopen the resume. |
| I need a refund | Contact the board admin; refunds are made in the platform dashboard. |
| No emails arrive | Admin: check the **Email log**. `skipped` means mail is not set up yet. |
