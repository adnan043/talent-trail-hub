import type {PrismaClient} from '../../generated/prisma/client';
import {RESUME_RETENTION_DAYS} from '../../lib/board';
import {SiteKeyMissing} from '../../platform/api';
import {deleteFile} from '../../platform/files';
import {sendBoardEmail} from './email';
import {getBoardSettings, isSingleCompany} from './settings';

/**
 * The board's scheduled work as plain functions: run by the background jobs (src/server/background.ts,
 * schedules in background.json) and by the admin's "Run now" buttons (D). Idempotent, bounded
 * batches: every change is CLAIMED with a conditional update, so two runs at once (a schedule and
 * a button) never both send an email, and a second run finds nothing left to do. Each run stops
 * after a time budget well inside a background job's 60 s; what is left waits for the next run.
 */
export interface TaskResult {
  /** What changed, for the admin's toast and the audit log. */
  summary: Record<string, number>;
}

export const REMINDER_DAYS = 3;
const DAY_MS = 86_400_000;
const BATCH = 50;
const MAX_BATCHES = 20;
const BUDGET_MS = 40_000;
/** Where an employer renews a listing (the employer area, workstream C). */
const RENEW_PATH = '/dashboard/employer/jobs';

const jobSelect = {id: true, title: true, companyId: true, expiresAt: true, company: {select: {ownerUserId: true}}} as const;
type DueJob = {id: number; title: string; companyId: number; expiresAt: Date | null; company: {ownerUserId: number | null}};

const expiresOn = (d: Date) => d.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'});

/** The active owners' emails of these jobs' companies, by user id (one query). */
async function ownerEmails(db: PrismaClient, jobs: DueJob[]): Promise<Map<number, string>> {
  const ids = [...new Set(jobs.map(j => j.company.ownerUserId).filter((id): id is number => id !== null))];
  if (!ids.length) return new Map();
  const users = await db.user.findMany({where: {id: {in: ids}, status: 'active'}, select: {id: true, email: true}});
  return new Map(users.map(u => [u.id, u.email]));
}

/** Recounts `companies.active_job_count` (published, unexpired) for these companies. */
async function recountActive(db: PrismaClient, companyIds: Iterable<number>) {
  const ids = [...new Set(companyIds)];
  if (!ids.length) return;
  await db.$executeRaw`
    UPDATE "companies" c SET "active_job_count" = (
      SELECT count(*)::int FROM "jobs" j
      WHERE j."company_id" = c."id" AND j."status" = 'published' AND j."expires_at" > now()
    ), "updated_at" = now()
    WHERE c."id" = ANY(${ids}::int[])`;
}

/**
 * Pages through due jobs; `claim` takes one (false: another run did) and `after` acts on the
 * claimed ones. Claimed rows drop out of the next page.
 */
async function forEachDue(
  find: () => Promise<DueJob[]>,
  claim: (job: DueJob) => Promise<boolean>,
  after: (jobs: DueJob[]) => Promise<void>,
  deadline: number
): Promise<number> {
  let done = 0;
  for (let batch = 0; batch < MAX_BATCHES && Date.now() < deadline; batch++) {
    const jobs = await find();
    let claimed = 0;
    // One job at a time, checking the budget before each: a slow email or storage call never
    // leaves a batch claimed (marked expired / reminded) with its emails unsent.
    for (const job of jobs) {
      if (Date.now() >= deadline) return done + claimed;
      if (!(await claim(job))) continue;
      await after([job]);
      claimed++;
    }
    done += claimed;
    if (jobs.length < BATCH || claimed === 0) break;
  }
  return done;
}

/** Expires jobs and featured flags past their date; sends the 3-days-before reminder once. */
export async function runExpiry(db: PrismaClient, requestUrl: string, now = new Date()): Promise<TaskResult> {
  const deadline = Date.now() + BUDGET_MS;
  const settings = await getBoardSettings(db);
  // Renew links lead to the employer area, which a single-company board doesn't have (F39).
  const notify = !isSingleCompany(settings);
  const send = async (jobs: DueJob[], template: 'job-expired' | 'job-expiring') => {
    if (!notify || !jobs.length) return;
    const emails = await ownerEmails(db, jobs);
    for (const job of jobs) {
      const to = job.company.ownerUserId === null ? undefined : emails.get(job.company.ownerUserId);
      if (!to) continue;
      const vars: Record<string, string> = {boardName: settings.name, jobTitle: job.title, renewUrl: RENEW_PATH};
      if (job.expiresAt) vars.expiresOn = expiresOn(job.expiresAt);
      await sendBoardEmail(db, requestUrl, {template, to, vars});
    }
  };

  const expired = await forEachDue(
    () =>
      db.job.findMany({
        where: {status: 'published', expiresAt: {lte: now}},
        select: jobSelect,
        orderBy: [{expiresAt: 'asc'}, {id: 'asc'}],
        take: BATCH,
      }),
    async job =>
      (await db.job.updateMany({where: {id: job.id, status: 'published', expiresAt: {lte: now}}, data: {status: 'expired'}})).count === 1,
    async jobs => {
      await recountActive(db, jobs.map(j => j.companyId));
      await send(jobs, 'job-expired');
    },
    deadline
  );

  // Featured upgrades end on their own date, whatever the listing does.
  let unfeatured = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const due = await db.job.findMany({
      where: {isFeatured: true, featuredUntil: {lte: now}},
      select: {id: true},
      orderBy: {id: 'asc'},
      take: 500,
    });
    if (!due.length) break;
    const {count} = await db.job.updateMany({
      where: {id: {in: due.map(j => j.id)}, isFeatured: true, featuredUntil: {lte: now}},
      data: {isFeatured: false},
    });
    unfeatured += count;
    if (due.length < 500) break;
  }

  const reminded = notify
    ? await forEachDue(
        () =>
          db.job.findMany({
            where: {status: 'published', expiryReminderSentAt: null, expiresAt: {gt: now, lte: new Date(now.getTime() + REMINDER_DAYS * DAY_MS)}},
            select: jobSelect,
            orderBy: [{expiresAt: 'asc'}, {id: 'asc'}],
            take: BATCH,
          }),
        // Claimed even without an owner to email, so the row isn't picked up again every hour.
        async job =>
          // Only the listing period it was found in: a renew in between resets the reminder for the new date.
          (
            await db.job.updateMany({
              where: {id: job.id, status: 'published', expiresAt: job.expiresAt, expiryReminderSentAt: null},
              data: {expiryReminderSentAt: now},
            })
          ).count === 1,
        jobs => send(jobs, 'job-expiring'),
        deadline
      )
    : 0;

  return {summary: {expired, unfeatured, reminded}};
}

/** Deletes one stored file; true when it is gone (a file already missing counts as gone). */
async function removeFile(requestUrl: string, fileId: string): Promise<boolean> {
  try {
    const res = await deleteFile(requestUrl, fileId);
    return res.ok || res.status === 404;
  } catch (err) {
    if (err instanceof SiteKeyMissing) throw err;
    return false; // not a file id, or storage misbehaved: try again next run
  }
}

/** Deletes resumes past RESUME_RETENTION_DAYS (keeps the application), sweeps stale uploads and attempts. */
export async function runPurge(db: PrismaClient, requestUrl: string, now = new Date()): Promise<TaskResult> {
  const deadline = Date.now() + BUDGET_MS;
  const retentionCutoff = new Date(now.getTime() - RESUME_RETENTION_DAYS * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const failedApps: number[] = [];
  const failedUploads: number[] = [];
  let resumesPurged = 0;
  let uploadsSwept = 0;

  try {
    // 1. Resumes past retention: delete the file FIRST, then clear the fields only if they still
    //    point at it (a failed delete is retried next run; a second run finds nothing).
    for (let batch = 0; batch < MAX_BATCHES && Date.now() < deadline; batch++) {
      const due = await db.application.findMany({
        where: {createdAt: {lt: retentionCutoff}, resumeFileId: {not: null}, id: {notIn: failedApps}},
        select: {id: true, resumeFileId: true},
        orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
        take: BATCH,
      });
      for (const app of due) {
        if (Date.now() >= deadline) break;
        if (!(await removeFile(requestUrl, app.resumeFileId!))) {
          failedApps.push(app.id);
          continue;
        }
        const {count} = await db.application.updateMany({
          where: {id: app.id, resumeFileId: app.resumeFileId},
          data: {resumeFileId: null, resumeFileName: null},
        });
        await db.resumeUpload.deleteMany({where: {applicationId: app.id}});
        resumesPurged += count;
      }
      if (due.length < BATCH) break;
    }

    // 2. Uploads never attached to an application, older than a day: the file, then the row.
    for (let batch = 0; batch < MAX_BATCHES && Date.now() < deadline; batch++) {
      const stale = await db.resumeUpload.findMany({
        where: {applicationId: null, createdAt: {lt: dayAgo}, id: {notIn: failedUploads}},
        select: {id: true, fileId: true},
        orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
        take: BATCH,
      });
      for (const upload of stale) {
        if (Date.now() >= deadline) break;
        if (!(await removeFile(requestUrl, upload.fileId))) {
          failedUploads.push(upload.id);
          continue;
        }
        uploadsSwept += (await db.resumeUpload.deleteMany({where: {id: upload.id, applicationId: null}})).count;
      }
      if (stale.length < BATCH) break;
    }
  } catch (err) {
    // No Site Key (a machine without one): no stored files to delete; the rest still runs.
    if (!(err instanceof SiteKeyMissing)) throw err;
  }

  // 3. Rate-limit rows older than a day, in bounded deletes.
  let attemptsSwept = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const n = await db.$executeRaw`
      DELETE FROM "board_attempts" WHERE "id" IN (
        SELECT "id" FROM "board_attempts" WHERE "created_at" < ${dayAgo} ORDER BY "created_at" LIMIT 5000
      )`;
    attemptsSwept += n;
    if (n < 5000) break;
  }

  return {
    summary: {resumesPurged, resumesFailed: failedApps.length, uploadsSwept, uploadsFailed: failedUploads.length, attemptsSwept},
  };
}
