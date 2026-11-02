import {type Context, Hono} from 'hono';
import {createMiddleware} from 'hono/factory';
import {validator} from 'hono/validator';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {APPLICATION_STATUSES, type ApplicationStatus, LIMITS} from '../../lib/board';
import type {Viewer} from '../../lib/types';
import {SiteKeyMissing} from '../../platform/api';
import {audit} from '../../platform/auth';
import {fileUrl} from '../../platform/files';
import {can, problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {
  adminApplicationSelect,
  applicantScope,
  csvHeader,
  csvLines,
  applicationSelect,
  attachment,
  idOf,
  isResumeExpired,
  jobWhereOf,
  STATUS_TEMPLATES,
  toApplicantRow,
} from '../board/applicants';
import {sendBoardEmail} from '../board/email';
import {ipHashOf} from '../board/ip';
import {cachedBoardSettings} from '../board/brand';
import {PERMISSIONS} from '../permissions';

/**
 * F16 / F39 applicants (under `/site-api/applications`). The employer reaches their own company's
 * applicants (marketplace mode only); holders of `site:applicant:read` reach everyone's.
 *
 *   GET   /jobs/:id/applicants[/export]   one job's applicants (keyset page) or its CSV
 *   GET   /all[/export], /all/jobs        the admin's list of every applicant, its CSV, job filter
 *   PATCH /:id                            status and private notes
 *   POST  /:id/resume-link                a 10-minute download link (410 once past retention)
 */
type Env = {Variables: {viewer: Viewer; db: PrismaClient}};
const PAGE = LIMITS.pageSize;
/** CSV exports: the newest 5,000, read in keyset batches of 500 (only the CSV text is kept). */
const EXPORT_MAX = 5000;
const EXPORT_BATCH = 500;
const LINK_SECONDS = 600;

const notFound = (c: Context) => c.json(problem('not_found', 'No such job or applicant.'), 404);
const expired = (c: Context) =>
  c.json(problem('resume_expired', 'This resume was deleted after 180 days, as the privacy policy says.'), 410);

const statusOf = (v: unknown): ApplicationStatus | '' =>
  typeof v === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(v) ? (v as ApplicationStatus) : '';

const listQuery = validator('query', v => ({
  status: statusOf(v.status),
  before: idOf(typeof v.before === 'string' ? v.before : undefined),
  job: idOf(typeof v.job === 'string' ? v.job : undefined),
}));

const patchBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const status = v.status === undefined ? undefined : statusOf(v.status);
  if (status === '') return c.json({...problem('invalid_input', 'Pick a status.'), fields: {status: 'Pick a status.'}}, 422);
  let notes: string | undefined;
  if (v.notes !== undefined) {
    if (typeof v.notes !== 'string' || v.notes.trim().length > LIMITS.employerNotes) {
      const message = `Notes can be at most ${LIMITS.employerNotes} characters.`;
      return c.json({...problem('invalid_input', message), fields: {notes: message}}, 422);
    }
    notes = v.notes.trim();
  }
  if (status === undefined && notes === undefined) return c.json(problem('invalid_input', 'Nothing to change.'), 422);
  return {status, notes};
});

const csvResponse = (c: Context, csv: string, name: string) =>
  c.body(csv, 200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': attachment(name)});

/** The newest EXPORT_MAX applications matching `where`, as CSV, built batch by batch. */
async function exportCsv(db: PrismaClient, where: Prisma.ApplicationWhereInput, withJob: boolean) {
  const parts = [csvHeader(withJob)];
  let before: number | undefined;
  let count = 0;
  while (count < EXPORT_MAX) {
    const rows = await db.application.findMany({
      where: {...where, ...(before ? {id: {lt: before}} : {})},
      select: adminApplicationSelect,
      orderBy: {id: 'desc'},
      take: Math.min(EXPORT_BATCH, EXPORT_MAX - count),
    });
    if (!rows.length) break;
    parts.push(csvLines(rows.map(r => toApplicantRow(r)), withJob));
    count += rows.length;
    before = rows.at(-1)!.id;
    if (rows.length < EXPORT_BATCH) break;
  }
  return {csv: parts.join(''), count};
}

/**
 * The employer (company) scope needs a confirmed email, as the `/employer` area does
 * (`requireVerified`); holders of `site:applicant:read` pass as before.
 */
const verifiedUnlessStaff = createMiddleware<Env>(async (c, next) => {
  if (!c.var.viewer.emailVerified && !(await can(c as never, PERMISSIONS.APPLICANT_READ_ALL))) {
    return c.json(problem('email_unverified', 'Confirm your email address first.'), 403);
  }
  await next();
});

/** The application `id`, only when its job is in the viewer's scope. */
async function findInScope(c: Context<Env>, id: number | null) {
  const where = jobWhereOf(await applicantScope(c));
  if (!id || !where) return null;
  return c.var.db.application.findFirst({where: {id, job: where}, select: applicationSelect});
}

export const applicantRoutes = new Hono<Env>()
  .get('/jobs/:id/applicants', listQuery, withViewer, requireAuth, verifiedUnlessStaff, withDb, async c => {
    const where = jobWhereOf(await applicantScope(c));
    const jobId = idOf(c.req.param('id'));
    if (!where || !jobId) return notFound(c);
    const job = await c.var.db.job.findFirst({
      where: {...where, id: jobId},
      select: {id: true, title: true, slug: true, status: true, applicationCount: true},
    });
    if (!job) return notFound(c);
    const {status, before} = c.req.valid('query');
    const rows = await c.var.db.application.findMany({
      where: {jobId, ...(status ? {status} : {}), ...(before ? {id: {lt: before}} : {})},
      select: applicationSelect,
      orderBy: {id: 'desc'},
      take: PAGE + 1,
    });
    const items = rows.slice(0, PAGE).map(r => toApplicantRow(r));
    return c.json({job, items, nextBefore: rows.length > PAGE ? items.at(-1)!.id : null});
  })

  .get('/jobs/:id/applicants/export', listQuery, withViewer, requireAuth, verifiedUnlessStaff, withDb, async c => {
    const where = jobWhereOf(await applicantScope(c));
    const jobId = idOf(c.req.param('id'));
    if (!where || !jobId) return notFound(c);
    const job = await c.var.db.job.findFirst({where: {...where, id: jobId}, select: {id: true, slug: true}});
    if (!job) return notFound(c);
    const {status} = c.req.valid('query');
    const {csv, count} = await exportCsv(c.var.db, {jobId, ...(status ? {status} : {})}, false);
    await audit(c.var.db, {actorUserId: c.var.viewer.id, action: 'applicants_exported', target: ['job', job.id], meta: {count}});
    return csvResponse(c, csv, `applicants-${job.slug.slice(0, 60)}.csv`);
  })

  .get('/all', listQuery, withViewer, requireAuth, requirePermission(PERMISSIONS.APPLICANT_READ_ALL), withDb, async c => {
    const {status, before, job} = c.req.valid('query');
    const rows = await c.var.db.application.findMany({
      where: {...(job ? {jobId: job} : {}), ...(status ? {status} : {}), ...(before ? {id: {lt: before}} : {})},
      select: adminApplicationSelect,
      orderBy: {id: 'desc'},
      take: PAGE + 1,
    });
    const items = rows.slice(0, PAGE).map(r => toApplicantRow(r));
    return c.json({items, nextBefore: rows.length > PAGE ? items.at(-1)!.id : null});
  })

  .get('/all/export', listQuery, withViewer, requireAuth, requirePermission(PERMISSIONS.APPLICANT_READ_ALL), withDb, async c => {
    const {status, job} = c.req.valid('query');
    const {csv, count} = await exportCsv(c.var.db, {...(job ? {jobId: job} : {}), ...(status ? {status} : {})}, true);
    await audit(c.var.db, {actorUserId: c.var.viewer.id, action: 'applicants_exported', ...(job ? {target: ['job', job] as [string, number]} : {}), meta: {count}});
    return csvResponse(c, csv, 'applicants.csv');
  })

  .get('/all/jobs', withViewer, requireAuth, requirePermission(PERMISSIONS.APPLICANT_READ_ALL), withDb, async c => {
    const jobs = await c.var.db.job.findMany({
      where: {applicationCount: {gt: 0}},
      select: {id: true, title: true, applicationCount: true, company: {select: {name: true}}},
      orderBy: {id: 'desc'},
      take: 100,
    });
    return c.json({jobs: jobs.map(j => ({id: j.id, title: j.title, company: j.company.name, applicationCount: j.applicationCount}))});
  })

  .patch('/:id', patchBody, withViewer, requireAuth, verifiedUnlessStaff, withDb, async c => {
    const db = c.var.db;
    const found = await findInScope(c, idOf(c.req.param('id')));
    if (!found) return notFound(c);
    const {status, notes} = c.req.valid('json');
    // ONE write for status and notes. A repeat or a concurrent change still emails once (below).
    const changed = status !== undefined && status !== found.status;
    const row = await db.application.update({
      where: {id: found.id},
      data: {...(status ? {status} : {}), ...(notes !== undefined ? {employerNotes: notes || null} : {})},
      select: applicationSelect,
    });
    const template = changed && status && status in STATUS_TEMPLATES ? STATUS_TEMPLATES[status as keyof typeof STATUS_TEMPLATES] : null;
    // The candidate hears each outcome at most ONCE per application: shortlisted (`status_emailed_at`)
    // and rejected (`rejected_emailed_at`). Moving back and forth never sends a second one.
    const mark = status === 'rejected' ? 'rejectedEmailedAt' : 'statusEmailedAt';
    if (template && (await db.application.updateMany({where: {id: found.id, [mark]: null}, data: {[mark]: new Date()}})).count === 1) {
      const [job, settings] = await Promise.all([
        db.job.findUnique({where: {id: found.jobId}, select: {title: true, company: {select: {name: true}}}}),
        cachedBoardSettings(db),
      ]);
      if (job) {
        await sendBoardEmail(db, c.req.url, {
          template,
          to: found.email,
          vars: {boardName: settings.name, applicantName: found.name, jobTitle: job.title, companyName: job.company.name},
        });
      }
    }
    return c.json({applicant: toApplicantRow(row)});
  })

  .post('/:id/resume-link', withViewer, requireAuth, verifiedUnlessStaff, withDb, async c => {
    const db = c.var.db;
    const scope = await applicantScope(c);
    const id = idOf(c.req.param('id'));
    const where = jobWhereOf(scope);
    if (!id || !where) return notFound(c);
    const found = await db.application.findFirst({
      where: {id, job: where},
      select: {id: true, resumeFileId: true, createdAt: true, job: {select: {companyId: true, company: {select: {ownerUserId: true}}}}},
    });
    if (!found) return notFound(c);
    // F36 retention guard: refused even before the purge has deleted the file.
    if (isResumeExpired(found.createdAt)) return expired(c);
    if (!found.resumeFileId) return c.json(problem('no_resume', 'This application has no resume file.'), 404);
    let link;
    try {
      link = await fileUrl(c.req.url, found.resumeFileId, {expiresIn: LINK_SECONDS, download: true});
    } catch (err) {
      if (!(err instanceof SiteKeyMissing)) throw err;
      link = {ok: false as const, status: 503, code: 'E_STORAGE_UNAVAILABLE', message: 'Resume downloads are not available on this machine.'};
    }
    if (!link.ok) return c.json(problem(link.code, link.message), link.status === 404 ? 404 : 503);
    // Every resume download is logged, the employer's own and staff's (`meta.staff`).
    await audit(db, {
      actorUserId: c.var.viewer.id,
      action: 'resume_downloaded',
      target: ['application', found.id],
      ipHash: await ipHashOf(c),
      meta: {staff: scope.kind === 'all' && found.job.company.ownerUserId !== c.var.viewer.id},
    });
    return c.json({url: link.data.url, expiresAt: link.data.expiresAt});
  });
