import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Prisma} from '../../generated/prisma/client';
import {JOB_SOURCES, JOB_STATUSES, type JobSource} from '../../lib/board';
import type {AdminJobRow, AdminJobsPage, TaskRun} from '../../lib/types-manage';
import {MANAGE_LIMITS} from '../../lib/types-manage';
import {audit} from '../../platform/auth';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {featuredWhere} from './public';
import {manageJobEditRoutes} from './manage-job-edit';
import {actionsFor, actorOf, asObject, DAY_MS, effectiveStatus, deleteStoredFiles, idParam, invalid, isFeaturedNow, notFound, refreshActiveJobCount} from './manage-shared';
import {runExpiry} from './tasks';

/**
 * F21 admin jobs: the filtered list (keyset by id, newest first), feature / unfeature, extend,
 * close, delete and "Run expiry now". Create and edit (admin and import jobs only) are in
 * ./manage-job-edit.ts. Every change is audited.
 */
const PAGE = 25;
const DELETE_BATCH = 200;
const DELETE_BUDGET_MS = 20_000;

const pick = <T extends string>(set: readonly T[], value: unknown): T | '' =>
  typeof value === 'string' && (set as readonly string[]).includes(value) ? (value as T) : '';

const text = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Every filter is a string here (the typed client sends them as they are); parsed in the handler. */
const listQuery = validator('query', v => ({
  before: text(v.before, 12),
  status: text(v.status, 20),
  category: text(v.category, 12),
  featured: text(v.featured, 3),
  source: text(v.source, 10),
  q: text(v.q),
}));

const parseFilters = (q: Record<'before' | 'status' | 'category' | 'featured' | 'source' | 'q', string>) => ({
  before: idParam(q.before) ?? undefined,
  status: pick(JOB_STATUSES, q.status),
  category: idParam(q.category) ?? undefined,
  featured: pick(['yes', 'no'] as const, q.featured),
  source: pick(JOB_SOURCES, q.source),
  q: q.q,
});

function listWhere(f: {status: string; category?: number; featured: string; source: string; q: string}, now: Date): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [];
  // Unpaid wizard jobs only when asked for by status.
  if (!f.status) and.push({status: {notIn: ['draft', 'pending_payment']}});
  else if (f.status === 'published') and.push({status: 'published', expiresAt: {gt: now}});
  else if (f.status === 'expired') and.push({OR: [{status: 'expired'}, {status: 'published', expiresAt: {lte: now}}]});
  else and.push({status: f.status});
  if (f.category) and.push({categoryId: f.category});
  if (f.featured === 'yes') and.push(featuredWhere(now));
  if (f.featured === 'no') and.push({OR: [{isFeatured: false}, {featuredUntil: {lte: now}}]});
  if (f.source) and.push({source: f.source});
  if (f.q) and.push({title: {contains: f.q, mode: 'insensitive'}});
  return {AND: and};
}

const daysBody = (max: number, required: boolean) =>
  validator('json', (value, c) => {
    const raw = asObject(value).days;
    if (raw === undefined && !required) return {days: null};
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > max) {
      return invalid(c, {days: `Pick a whole number of days from 1 to ${max}.`});
    }
    return {days: raw as number};
  });

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.JOB_MANAGE), withDb] as const;
const jobFacts = {id: true, title: true, status: true, source: true, companyId: true, isFeatured: true, featuredUntil: true, publishedAt: true, expiresAt: true, needsReview: true} as const;

const NEEDS_REVIEW = problem('needs_review', 'This job has changes waiting for review. Approve it in Moderation first.');

export const manageJobRoutes = new Hono()
  .get('/', listQuery, ...guard, async c => {
    const {before, ...filters} = parseFilters(c.req.valid('query'));
    const now = new Date();
    const rows = await c.var.db.job.findMany({
      where: {...listWhere(filters, now), ...(before ? {id: {lt: before}} : {})},
      orderBy: {id: 'desc'},
      take: PAGE + 1,
      select: {
        ...jobFacts,
        slug: true,
        viewCount: true,
        applicationCount: true,
        createdAt: true,
        company: {select: {name: true}},
        category: {select: {name: true}},
      },
    });
    const jobs: AdminJobRow[] = rows.slice(0, PAGE).map(j => {
      const status = effectiveStatus(j, now);
      const featured = status === 'published' && isFeaturedNow(j, now);
      return {
        id: j.id,
        title: j.title,
        slug: j.slug,
        status,
        source: j.source as JobSource,
        company: j.company.name,
        category: j.category.name,
        featured,
        featuredUntil: featured ? (j.featuredUntil?.toISOString() ?? null) : null,
        expiresAt: j.expiresAt?.toISOString() ?? null,
        views: j.viewCount,
        applicants: j.applicationCount,
        createdAt: j.createdAt.toISOString(),
        needsReview: j.needsReview,
        actions: actionsFor(status, j.source),
      };
    });
    const body: AdminJobsPage = {jobs, nextBefore: rows.length > PAGE ? jobs.at(-1)!.id : null};
    return c.json(body);
  })

  .post('/run-expiry', ...guard, async c => {
    const result = await runExpiry(c.var.db, c.req.url);
    await audit(c.var.db, {...(await actorOf(c)), action: 'expiry_run', meta: result.summary});
    const s = result.summary;
    const body: TaskRun = {
      summary: s,
      message: `Expiry ran: ${s.expired ?? 0} expired, ${s.unfeatured ?? 0} no longer featured, ${s.reminded ?? 0} reminders sent.`,
    };
    return c.json(body);
  })

  .route('/', manageJobEditRoutes)

  .post('/:id/feature', validator('json', v => ({featured: asObject(v).featured === true, days: asObject(v).days})), ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const {featured, days: rawDays} = c.req.valid('json');
    const days = rawDays === undefined ? MANAGE_LIMITS.featureDaysDefault : rawDays;
    if (featured && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MANAGE_LIMITS.extendDaysMax)) {
      return invalid(c, {days: `Pick a whole number of days from 1 to ${MANAGE_LIMITS.extendDaysMax}.`});
    }
    const db = c.var.db;
    const now = new Date();
    const job = await db.job.findUnique({where: {id}, select: jobFacts});
    if (!job) return notFound(c);
    if (featured && effectiveStatus(job, now) !== 'published') return c.json(problem('not_live', 'Only live jobs can be featured.'), 409);
    if (featured && job.needsReview) return c.json(NEEDS_REVIEW, 409);
    let featuredUntil: Date | null = null;
    if (featured) {
      const start = isFeaturedNow(job, now) && job.featuredUntil ? job.featuredUntil : now;
      featuredUntil = new Date(start.getTime() + (days as number) * DAY_MS);
    }
    await db.job.update({where: {id}, data: {isFeatured: featured, featuredUntil}, select: {id: true}});
    await audit(db, {
      ...(await actorOf(c)),
      action: featured ? 'job_featured' : 'job_unfeatured',
      target: ['job', id],
      meta: {featuredUntil: featuredUntil?.toISOString() ?? null},
    });
    return c.json({featuredUntil: featuredUntil?.toISOString() ?? null});
  })

  .post('/:id/extend', daysBody(MANAGE_LIMITS.extendDaysMax, true), ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const days = c.req.valid('json').days as number;
    const db = c.var.db;
    const now = new Date();
    const job = await db.job.findUnique({where: {id}, select: jobFacts});
    if (!job) return notFound(c);
    const status = effectiveStatus(job, now);
    if (!actionsFor(status, job.source).extend) {
      return c.json(problem('not_extendable', 'Only live, expired or closed jobs can be extended.'), 409);
    }
    if (job.needsReview) return c.json(NEEDS_REVIEW, 409);
    // A job that never went live (closed while in review) has never been approved: only
    // moderation may put it on the board for the first time.
    if (!job.publishedAt) {
      return c.json(problem('never_published', 'This job was never approved, so it cannot be listed again from here. It has to go through review.'), 409);
    }
    // Live: more days on top. Expired or closed: listed again from now.
    const live = status === 'published' && job.expiresAt;
    const expiresAt = new Date((live ? job.expiresAt!.getTime() : now.getTime()) + days * DAY_MS);
    const {count} = await db.job.updateMany({
      where: {id, status: job.status, expiresAt: job.expiresAt},
      data: {status: 'published', expiresAt, expiryReminderSentAt: null, ...(live ? {} : {publishedAt: now})},
    });
    if (!count) return c.json(problem('changed', 'This job changed in the meantime. Reload and try again.'), 409);
    await audit(db, {...(await actorOf(c)), action: 'job_extended', target: ['job', id], meta: {days, expiresAt: expiresAt.toISOString()}});
    await refreshActiveJobCount(db, job.companyId, now);
    return c.json({expiresAt: expiresAt.toISOString()});
  })

  .post('/:id/close', ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const db = c.var.db;
    const job = await db.job.findUnique({where: {id}, select: jobFacts});
    if (!job) return notFound(c);
    if (job.status !== 'published' && job.status !== 'pending_review') {
      return c.json(problem('not_closable', 'Only live or in-review jobs can be closed.'), 409);
    }
    const {count} = await db.job.updateMany({where: {id, status: job.status}, data: {status: 'closed'}});
    if (!count) return c.json(problem('changed', 'This job changed in the meantime. Reload and try again.'), 409);
    await audit(db, {...(await actorOf(c)), action: 'job_closed', target: ['job', id]});
    await refreshActiveJobCount(db, job.companyId);
    return c.json({ok: true});
  })

  .delete('/:id', ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const db = c.var.db;
    const job = await db.job.findUnique({where: {id}, select: {...jobFacts, slug: true}});
    if (!job) return notFound(c);
    // Applications first, in bounded batches (rows, then that batch's resume files), within a time
    // budget; the job goes once none is left. A very long history answers 409: press delete again.
    const deadline = Date.now() + DELETE_BUDGET_MS;
    let applications = 0;
    let filesLeft = 0;
    for (;;) {
      const batch = await db.application.findMany({where: {jobId: id}, select: {id: true, resumeFileId: true}, orderBy: {id: 'asc'}, take: DELETE_BATCH});
      if (!batch.length) break;
      const ids = batch.map(a => a.id);
      await db.$transaction([
        db.resumeUpload.deleteMany({where: {applicationId: {in: ids}}}),
        db.application.deleteMany({where: {id: {in: ids}}}),
      ]);
      applications += batch.length;
      filesLeft += await deleteStoredFiles(c.req.url, batch.flatMap(a => (a.resumeFileId ? [a.resumeFileId] : [])), deadline);
      if (batch.length < DELETE_BATCH) break;
      if (Date.now() > deadline) {
        if (filesLeft) console.warn(`job ${id}: ${filesLeft} resume files could not be deleted`);
        return c.json(problem('delete_in_progress', `${applications} applications deleted so far. Delete the job again to finish.`), 409);
      }
    }
    await db.job.delete({where: {id}, select: {id: true}});
    await audit(db, {...(await actorOf(c)), action: 'job_deleted', target: ['job', id], meta: {applications}});
    await refreshActiveJobCount(db, job.companyId);
    if (filesLeft) console.warn(`job ${id} deleted: ${filesLeft} resume files could not be deleted`);
    return c.json({ok: true, filesLeft});
  });
