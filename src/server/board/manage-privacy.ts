import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import type {PrivacyDeleted, PrivacyLookup, TaskRun} from '../../lib/types-manage';
import {audit, normalizeEmail} from '../../platform/auth';
import {SiteKeyMissing} from '../../platform/api';
import {config} from '../../platform/config';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {actorOf, asObject, deleteStoredFiles, idParam, invalid} from './manage-shared';
import {runPurge} from './tasks';

/**
 * F36 privacy tool: look up an email (POSTed, never in a URL), see what the board keeps for it,
 * delete all of it or one application. Applications with their resume files and resume upload
 * rows, and the email log's rows to that address. Jobs, companies, users and orders stay.
 * The audit log never holds the address: a salted hash (HMAC with the site's secret) lets a later
 * request be matched to this one.
 */
const ITEMS = 100;
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
    await tx.resumeUpload.deleteMany({where: {applicationId: {in: apps.map(a => a.id)}}});
    const {count} = await tx.application.deleteMany({where: {id: {in: apps.map(a => a.id)}}});
    const perJob = new Map<number, number>();
    for (const a of apps) perJob.set(a.jobId, (perJob.get(a.jobId) ?? 0) + 1);
    for (const [jobId, n] of perJob) {
      await tx.job.updateMany({where: {id: jobId, applicationCount: {gte: n}}, data: {applicationCount: {decrement: n}}});
    }
    return {files: apps.flatMap(a => (a.resumeFileId ? [a.resumeFileId] : [])), count};
  });
}

/** Files go once the rows are gone, so no application points at a missing file. */
async function deleteFiles(requestUrl: string, fileIds: string[]): Promise<number> {
  const left = await deleteStoredFiles(requestUrl, fileIds, Date.now() + 20_000);
  if (left) console.warn(`privacy: ${left} resume files could not be deleted`);
  return left;
}

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.PRIVACY_MANAGE), withDb] as const;

export const managePrivacyRoutes = new Hono()
  .post('/lookup', emailBody, ...guard, async c => {
    const {email} = c.req.valid('json');
    const db = c.var.db;
    const [rows, logs] = await Promise.all([
      db.application.findMany({
        where: {email},
        select: {id: true, createdAt: true, resumeFileId: true, job: {select: {title: true, company: {select: {name: true}}}}},
        orderBy: {id: 'desc'},
        take: ITEMS + 1,
      }),
      db.emailLog.findMany({where: {to: email}, select: {id: true}, orderBy: {id: 'desc'}, take: ITEMS + 1}),
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
      items,
      more: rows.length > ITEMS || logs.length > ITEMS,
    };
    return c.json(body);
  })

  .post('/delete', emailBody, ...guard, async c => {
    const {email} = c.req.valid('json');
    const db = c.var.db;
    const result: PrivacyDeleted = {applications: 0, resumeFiles: 0, emailLogs: 0};
    const files: string[] = [];
    // In batches, so a long history never builds one huge statement.
    for (;;) {
      const batch = await db.application.findMany({where: {email}, select: {id: true}, take: DELETE_BATCH});
      const done = await deleteApplications(db, batch.map(a => a.id));
      result.applications += done.count;
      files.push(...done.files);
      if (batch.length < DELETE_BATCH) break;
    }
    result.emailLogs = (await db.emailLog.deleteMany({where: {to: email}})).count;
    result.resumeFiles = files.length;
    await audit(db, {
      ...(await actorOf(c)),
      action: 'privacy_email_deleted',
      target: ['email', await emailAuditHash(email)],
      meta: {applications: result.applications, resumeFiles: result.resumeFiles, emailLogs: result.emailLogs},
    });
    const filesLeft = await deleteFiles(c.req.url, files);
    return c.json({deleted: result, filesLeft});
  })

  .post('/delete-application', emailBody, ...guard, async c => {
    const {email, applicationId} = c.req.valid('json');
    if (!applicationId) return invalid(c, {applicationId: 'Pick an application.'});
    const db = c.var.db;
    // The email must match: a stale or guessed id never removes someone else's application.
    const app = await db.application.findFirst({where: {id: applicationId, email}, select: {id: true, jobId: true}});
    if (!app) return c.json(problem('not_found', 'No such application for this email.'), 404);
    const done = await deleteApplications(db, [app.id]);
    await audit(db, {
      ...(await actorOf(c)),
      action: 'privacy_application_deleted',
      target: ['email', await emailAuditHash(email)],
      meta: {jobId: app.jobId, resumeFile: done.files.length > 0},
    });
    const filesLeft = await deleteFiles(c.req.url, done.files);
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
    const parts = Object.entries(result.summary).map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
    const body: TaskRun = {summary: result.summary, message: parts.length ? `Purge ran: ${parts.join(', ')}.` : 'Purge ran: nothing to do.'};
    return c.json(body);
  });
