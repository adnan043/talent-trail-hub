import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import type {PrivacyDeleted, PrivacyLookup, TaskRun} from '../../lib/types-manage';
import {audit, normalizeEmail} from '../../platform/auth';
import {SiteKeyMissing} from '../../platform/api';
import {config} from '../../platform/config';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {actorOf, asObject, deleteStoredFiles, handFilesToPurge, idParam, invalid, queueFilesForPurge} from './manage-shared';
import {runPurge} from './tasks';

/**
 * F36 privacy tool: look up an email (POSTed, never in a URL), see what the board keeps for it,
 * delete all of it or one application. Applications with their resume files and resume upload
 * rows, the email log's rows to that address, and the job seeker profile of the account with that
 * address (its details, photo and CV; the account itself stays, as a plain account that can set up
 * a profile again). Jobs, companies, users and orders stay.
 * The audit log never holds the address: a salted hash (HMAC with the site's secret) lets a later
 * request be matched to this one.
 */
const ITEMS = 100;
const MAX_DELETE_ROUNDS = 50;
const DELETE_BATCH = 500;
const encoder = new TextEncoder();

export async function emailAuditHash(email: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`privacy-email:${config.jwtSecret ?? ''}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(email));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
}

const emailBody = validator('json', (value, c) => {
  const v = asObject(value);
  const email = normalizeEmail(v.email);
  if (!email) {
    return invalid(c, {email: 'Enter the full email address, like name@example.com.'});
  }
  const applicationId = idParam(typeof v.applicationId === 'number' ? String(v.applicationId) : typeof v.applicationId === 'string' ? v.applicationId : '');
  return {email, applicationId};
});

/** Deletes these applications (and their upload rows), keeps the jobs' counters; returns their resume files. */
async function deleteApplications(db: PrismaClient, ids: number[]): Promise<{files: string[]; count: number}> {
  if (!ids.length) return {files: [], count: 0};
  return db.$transaction(async tx => {
    const apps = await tx.application.findMany({where: {id: {in: ids}}, select: {id: true, jobId: true, resumeFileId: true}});
    // Only the files nothing else uses (a profile CV stays while the profile has it).
    const files = await handFilesToPurge(tx as unknown as PrismaClient, apps.map(a => a.id), apps.flatMap(a => (a.resumeFileId ? [a.resumeFileId] : [])));
    const {count} = await tx.application.deleteMany({where: {id: {in: apps.map(a => a.id)}}});
    const perJob = new Map<number, number>();
    for (const a of apps) perJob.set(a.jobId, (perJob.get(a.jobId) ?? 0) + 1);
    if (perJob.size) {
      // Every job's counter in ONE statement (never a query per job), never below zero.
      const jobIds = [...perJob.keys()];
      const counts = jobIds.map(id => perJob.get(id)!);
      await tx.$executeRaw`
        UPDATE "jobs" j SET "application_count" = GREATEST(j."application_count" - d.n, 0)
        FROM unnest(${jobIds}::int[], ${counts}::int[]) AS d(id, n)
        WHERE j."id" = d.id`;
    }
    return {files, count};
  });
}

/** Files go once the rows are gone (no application points at a missing file); any left, the nightly purge deletes. */
async function deleteFiles(db: PrismaClient, requestUrl: string, fileIds: string[]): Promise<number> {
  const left = await deleteStoredFiles(db, requestUrl, fileIds, Date.now() + 20_000);
  if (left) console.warn(`privacy: ${left} resume files left for the nightly purge`);
  return left;
}

/** The job seeker profile of the account with this (normalized) address, if any. */
async function profileOf(db: PrismaClient, email: string) {
  const user = await db.user.findUnique({where: {email}, select: {id: true}});
  return user ? db.applicantProfile.findUnique({where: {userId: user.id}, select: {userId: true, photoFileId: true, resumeFileId: true}}) : null;
}

/**
 * The applications of this address: those sent with it, and those sent from the account that now
 * has it (under an older address it has since changed).
 */
async function applicationsWhere(db: PrismaClient, email: string) {
  const user = await db.user.findUnique({where: {email}, select: {id: true}});
  return user ? {OR: [{email}, {applicantUserId: user.id}]} : {email};
}

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.PRIVACY_MANAGE), withDb] as const;

export const managePrivacyRoutes = new Hono()
  .post('/lookup', emailBody, ...guard, async c => {
    const {email} = c.req.valid('json');
    const db = c.var.db;
    const mine = await applicationsWhere(db, email);
    const [rows, logs, profile] = await Promise.all([
      db.application.findMany({
        where: mine,
        select: {id: true, createdAt: true, resumeFileId: true, job: {select: {title: true, company: {select: {name: true}}}}},
        orderBy: {id: 'desc'},
        take: ITEMS + 1,
      }),
      db.emailLog.findMany({where: {to: email}, select: {id: true}, orderBy: {id: 'desc'}, take: ITEMS + 1}),
      profileOf(db, email),
    ]);
    const items = rows.slice(0, ITEMS).map(a => ({
      id: a.id,
      jobTitle: a.job.title,
      companyName: a.job.company.name,
      createdAt: a.createdAt.toISOString(),
      hasResume: a.resumeFileId !== null,
    }));
    const body: PrivacyLookup = {
      applications: items.length,
      resumeFiles: items.filter(i => i.hasResume).length,
      emailLogs: Math.min(logs.length, ITEMS),
      profile: profile !== null,
      items,
      more: rows.length > ITEMS || logs.length > ITEMS,
    };
    // A lookup shows personal data: it leaves a trace, as a delete does (the address only as a keyed hash).
    await audit(c.var.db, {
      ...(await actorOf(c)),
      action: 'privacy_email_lookup',
      target: ['email', await emailAuditHash(email)],
      meta: {applications: body.applications, emailLogs: body.emailLogs},
    });
    return c.json(body);
  })

  .post('/delete', emailBody, ...guard, async c => {
    const {email} = c.req.valid('json');
    const db = c.var.db;
    const result: PrivacyDeleted = {applications: 0, resumeFiles: 0, emailLogs: 0, profiles: 0};
    const files: string[] = [];
    // In batches, so a long history never builds one huge statement; bounded in time (a person
    // with even more rows is finished by running it again: the lookup shows what is left).
    const deadline = Date.now() + 20_000;
    const mine = await applicationsWhere(db, email);
    for (let round = 0; round < MAX_DELETE_ROUNDS && Date.now() < deadline; round++) {
      const batch = await db.application.findMany({where: mine, select: {id: true}, take: DELETE_BATCH});
      const done = await deleteApplications(db, batch.map(a => a.id));
      result.applications += done.count;
      files.push(...done.files);
      if (batch.length < DELETE_BATCH) break;
    }
    result.emailLogs = (await db.emailLog.deleteMany({where: {to: email}})).count;
    // The job seeker profile, after the applications (so its CV is no longer shared by them).
    const profile = await profileOf(db, email);
    if (profile) {
      const own = await db.$transaction(async tx => {
        const t = tx as unknown as PrismaClient;
        const {count} = await t.applicantProfile.deleteMany({where: {userId: profile.userId}});
        if (!count) return [];
        result.profiles = count;
        // The photo always; the CV unless an application still points at it (a later one, say).
        const cv = profile.resumeFileId && !(await t.application.findFirst({where: {resumeFileId: profile.resumeFileId}, select: {id: true}})) ? [profile.resumeFileId] : [];
        const gone = [...(profile.photoFileId ? [profile.photoFileId] : []), ...cv];
        await queueFilesForPurge(t, gone);
        return gone;
      });
      files.push(...own);
    }
    result.resumeFiles = files.length;
    await audit(db, {
      ...(await actorOf(c)),
      action: 'privacy_email_deleted',
      target: ['email', await emailAuditHash(email)],
      meta: {applications: result.applications, resumeFiles: result.resumeFiles, emailLogs: result.emailLogs, profiles: result.profiles},
    });
    const filesLeft = await deleteFiles(db, c.req.url, files);
    return c.json({deleted: result, filesLeft});
  })

  .post('/delete-application', emailBody, ...guard, async c => {
    const {email, applicationId} = c.req.valid('json');
    if (!applicationId) return invalid(c, {applicationId: 'Pick an application.'});
    const db = c.var.db;
    // The email must match: a stale or guessed id never removes someone else's application.
    const app = await db.application.findFirst({where: {id: applicationId, ...(await applicationsWhere(db, email))}, select: {id: true, jobId: true}});
    if (!app) return c.json(problem('not_found', 'No such application for this email.'), 404);
    const done = await deleteApplications(db, [app.id]);
    await audit(db, {
      ...(await actorOf(c)),
      action: 'privacy_application_deleted',
      target: ['email', await emailAuditHash(email)],
      meta: {jobId: app.jobId, resumeFile: done.files.length > 0},
    });
    const filesLeft = await deleteFiles(db, c.req.url, done.files);
    return c.json({ok: true, filesLeft});
  })

  .post('/run-purge', ...guard, async c => {
    let result;
    try {
      result = await runPurge(c.var.db, c.req.url);
    } catch (err) {
      if (!(err instanceof SiteKeyMissing)) throw err;
      return c.json(problem('platform_unavailable', 'Resumes are stored on the platform, which this copy of the site cannot reach (no Site Key).'), 503);
    }
    await audit(c.var.db, {...(await actorOf(c)), action: 'purge_run', meta: result.summary});
    const body: TaskRun = {summary: result.summary, message: purgeMessage(result.summary)};
    return c.json(body);
  });

/** Plain words for the toast: only what happened, failures last; all zeros reads as "nothing to clean up". */
function purgeMessage(s: Record<string, number>): string {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const done: string[] = [];
  if (s.resumesPurged) done.push(n(s.resumesPurged, 'old resume deleted', 'old resumes deleted'));
  if (s.uploadsSwept) done.push(n(s.uploadsSwept, 'unused upload removed', 'unused uploads removed'));
  if (s.profilesSwept) done.push(n(s.profilesSwept, 'profile of a deleted account removed', 'profiles of deleted accounts removed'));
  if (s.attemptsSwept) done.push(n(s.attemptsSwept, 'old rate-limit record cleared', 'old rate-limit records cleared'));
  const failed = (s.resumesFailed ?? 0) + (s.uploadsFailed ?? 0);
  let msg = done.length ? `Clean-up done: ${done.join(', ')}.` : 'Clean-up done: nothing was due.';
  if (failed) msg += ` ${n(failed, 'file', 'files')} could not be deleted; the next run will try again.`;
  return msg;
}
