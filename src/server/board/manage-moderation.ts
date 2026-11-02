import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {LIMITS, type JobSource} from '../../lib/board';
import type {ModerationDetail, ModerationItem, ModerationQueue, ModerationResult} from '../../lib/types-manage';
import {audit} from '../../platform/auth';
import {problem, requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {sendBoardEmail} from './email';
import {publishJob} from './lifecycle';
import {actorOf, asObject, effectiveStatus, employerEmail, idParam, invalid, notFound, originOf, refreshActiveJobCount, str} from './manage-shared';
import {getBoardSettings} from './settings';

/**
 * F20 moderation: the queue (oldest first), one job's review page, approve and reject. The admin
 * reviews employer content as it is: there is no edit here. Approving an edit of a live job keeps
 * its dates; rejecting a paid job says to refund it in the platform dashboard (no refund API).
 */
const PAGE = 50;
const HISTORY = 50;
const RECENT = 5;

const itemSelect = {
  id: true,
  title: true,
  source: true,
  flagged: true,
  updatedAt: true,
  publishedAt: true,
  expiresAt: true,
  company: {select: {id: true, name: true, isTrusted: true, ownerUserId: true}},
  orders: {
    where: {status: 'paid', amountCents: {gt: 0}},
    select: {amountCents: true, currency: true},
    orderBy: {id: 'desc'},
    take: 1,
  },
} satisfies Prisma.JobSelect;

type ItemRow = Prisma.JobGetPayload<{select: typeof itemSelect}>;

const keepsDates = (job: {publishedAt: Date | null; expiresAt: Date | null}, now: Date) =>
  job.publishedAt !== null && job.expiresAt !== null && job.expiresAt > now;

function toItem(row: ItemRow, now: Date): ModerationItem {
  const order = row.orders[0];
  return {
    id: row.id,
    title: row.title,
    company: {id: row.company.id, name: row.company.name, isTrusted: row.company.isTrusted},
    source: row.source as JobSource,
    flagged: row.flagged,
    submittedAt: row.updatedAt.toISOString(),
    liveUntil: keepsDates(row, now) ? row.expiresAt!.toISOString() : null,
    payment: order ? {amountCents: order.amountCents, currency: order.currency} : null,
  };
}

async function history(db: PrismaClient, companyId: number, jobId: number, now: Date) {
  const [jobs, orders] = await Promise.all([
    db.job.findMany({
      where: {companyId, status: {notIn: ['draft', 'pending_payment']}},
      select: {id: true, title: true, status: true, expiresAt: true, createdAt: true},
      orderBy: {id: 'desc'},
      take: HISTORY + 1,
    }),
    db.listingOrder.findMany({where: {companyId, status: 'paid'}, select: {amountCents: true}, orderBy: {id: 'desc'}, take: HISTORY}),
  ]);
  const listed = jobs.slice(0, HISTORY);
  const shown = listed.map(j => effectiveStatus(j, now));
  const recent = listed
    .filter(j => j.id !== jobId)
    .slice(0, RECENT)
    .map(j => ({id: j.id, title: j.title, status: effectiveStatus(j, now), createdAt: j.createdAt.toISOString()}));
  return {
    jobs: shown.length,
    live: shown.filter(s => s === 'published').length,
    rejected: shown.filter(s => s === 'rejected').length,
    more: jobs.length > HISTORY,
    paidOrders: orders.length,
    spentCents: orders.reduce((sum, o) => sum + o.amountCents, 0),
    recent,
  };
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(cents / 100);

const rejectBody = validator('json', (value, c) => {
  const reason = str(asObject(value).reason);
  if (reason.length < 3) return invalid(c, {reason: 'Say why, in a sentence the employer will read (at least 3 characters).'});
  if (reason.length > LIMITS.rejectionReason) return invalid(c, {reason: `Use at most ${LIMITS.rejectionReason} characters.`});
  return {reason};
});

/** `seen`: the job's `updatedAt` (the item's `submittedAt`) as the review page showed it. */
const approveBody = validator('json', (value, c) => {
  const v = asObject(value);
  const seen = typeof v.seen === 'string' ? new Date(v.seen) : null;
  if (!seen || Number.isNaN(seen.getTime())) return invalid(c, {seen: 'Reload the job and review it again.'});
  return {trust: v.trust === true, seen: seen.toISOString()};
});

const guard = [withViewer, requireAuth, requirePermission(PERMISSIONS.JOB_MODERATE), withDb] as const;

export const manageModerationRoutes = new Hono()
  // Flagged first, then first in, first reviewed. Keyset over (flagged desc, id asc).
  .get('/', validator('query', v => ({after: typeof v.after === 'string' ? v.after : ''})), ...guard, async c => {
    const cursor = /^([01]):(\d{1,9})$/.exec(c.req.valid('query').after);
    const after = cursor
      ? cursor[1] === '1'
        ? {OR: [{flagged: true, id: {gt: Number(cursor[2])}}, {flagged: false}]}
        : {flagged: false, id: {gt: Number(cursor[2])}}
      : {};
    const now = new Date();
    const rows = await c.var.db.job.findMany({
      where: {status: 'pending_review', ...after},
      select: itemSelect,
      orderBy: [{flagged: 'desc'}, {id: 'asc'}],
      take: PAGE + 1,
    });
    const items = rows.slice(0, PAGE).map(r => toItem(r, now));
    const last = items.at(-1);
    const body: ModerationQueue = {items, nextAfter: rows.length > PAGE && last ? `${last.flagged ? 1 : 0}:${last.id}` : null};
    return c.json(body);
  })

  .get('/:id', ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const now = new Date();
    const row = await c.var.db.job.findUnique({
      where: {id},
      select: {
        ...itemSelect,
        status: true,
        slug: true,
        descriptionHtml: true,
        employmentType: true,
        workplaceType: true,
        locationCity: true,
        locationRegion: true,
        locationCountry: true,
        salaryMinCents: true,
        salaryMaxCents: true,
        salaryCurrency: true,
        salaryPeriod: true,
        applyMethod: true,
        applyTarget: true,
        durationDays: true,
        listingFeatured: true,
        category: {select: {name: true}},
        tags: {select: {tag: {select: {name: true}}}, take: LIMITS.tags},
        company: {select: {id: true, name: true, isTrusted: true, ownerUserId: true, createdAt: true}},
      },
    });
    if (!row || row.status !== 'pending_review') return notFound(c, 'This job is not waiting for review.');
    const [past, owner] = await Promise.all([
      history(c.var.db, row.company.id, row.id, now),
      row.company.ownerUserId ? c.var.db.user.findUnique({where: {id: row.company.ownerUserId}, select: {emailVerifiedAt: true}}) : null,
    ]);
    const location = [row.locationCity, row.locationRegion, row.locationCountry].filter(Boolean).join(', ') || null;
    const hasSalary = row.salaryMinCents !== null || row.salaryMaxCents !== null;
    const body: ModerationDetail = {
      item: toItem(row, now),
      job: {
        slug: row.slug,
        descriptionHtml: row.descriptionHtml,
        category: row.category.name,
        employmentType: row.employmentType,
        workplaceType: row.workplaceType,
        location,
        salary: hasSalary
          ? {minCents: row.salaryMinCents, maxCents: row.salaryMaxCents, currency: row.salaryCurrency, period: row.salaryPeriod}
          : null,
        applyMethod: row.applyMethod,
        applyTarget: row.applyTarget,
        tags: row.tags.map(t => t.tag.name),
        durationDays: row.durationDays,
        listingFeatured: row.listingFeatured,
      },
      history: {...past, companySince: row.company.createdAt.toISOString()},
      employer: row.company.ownerUserId ? {verified: Boolean(owner?.emailVerifiedAt)} : null,
    };
    return c.json(body);
  })

  .post('/:id/approve', approveBody, ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const db = c.var.db;
    const now = new Date();
    const job = await db.job.findUnique({where: {id}, select: {...itemSelect, status: true, slug: true}});
    if (!job) return notFound(c);
    if (job.status !== 'pending_review') return c.json(problem('not_in_review', 'This job is no longer waiting for review.'), 409);
    const {trust, seen} = c.req.valid('json');
    const changed = () => c.json(problem('job_changed', 'This job changed since you opened it. Review it again.'), 409);
    if (job.updatedAt.toISOString() !== seen) return changed();
    const keep = keepsDates(job, now);
    // The row is locked while it is published, so an employer edit cannot slip in between the
    // check of what the moderator saw and the publish (it waits, then sees a live job).
    const published = await db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{id: number}[]>`
        SELECT "id" FROM "jobs" WHERE "id" = ${id} AND "status" = 'pending_review' AND "updated_at" = ${new Date(seen)} FOR UPDATE`;
      if (!rows.length) return false;
      const done = await publishJob(tx as unknown as PrismaClient, id, {from: ['pending_review'], keepDates: keep, now});
      // What the moderator saw is now approved: no changes wait for review.
      if (done) await tx.job.update({where: {id}, data: {needsReview: false}, select: {id: true}});
      return done;
    });
    if (!published) return changed();
    const actor = await actorOf(c);
    if (trust && !job.company.isTrusted) {
      await db.company.update({where: {id: job.company.id}, data: {isTrusted: true}, select: {id: true}});
      await audit(db, {...actor, action: 'company_trusted', target: ['company', job.company.id]});
    }
    await audit(db, {...actor, action: 'job_approved', target: ['job', id], meta: {keptDates: keep}});
    await refreshActiveJobCount(db, job.company.id, now);

    const [to, settings, fresh] = await Promise.all([
      employerEmail(db, job.company.ownerUserId),
      getBoardSettings(db),
      db.job.findUnique({where: {id}, select: {expiresAt: true}}),
    ]);
    if (to) {
      const expires = fresh?.expiresAt;
      await sendBoardEmail(db, c.req.url, {
        template: 'job-approved',
        to,
        vars: {
          boardName: settings.name,
          jobTitle: job.title,
          jobUrl: `${originOf(c.req.url)}/jobs/${job.slug}/`,
          expiresOn: expires ? expires.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'}) : '',
        },
      });
    }
    const body: ModerationResult = {status: 'published', message: `${job.title} is live.`, refundNote: null};
    return c.json(body);
  })

  .post('/:id/reject', rejectBody, ...guard, async c => {
    const id = idParam(c.req.param('id'));
    if (!id) return notFound(c);
    const db = c.var.db;
    const {reason} = c.req.valid('json');
    const job = await db.job.findUnique({where: {id}, select: {...itemSelect, status: true}});
    if (!job) return notFound(c);
    const {count} = await db.job.updateMany({
      where: {id, status: 'pending_review'},
      data: {status: 'rejected', rejectionReason: reason},
    });
    if (count === 0) return c.json(problem('not_in_review', 'This job is no longer waiting for review.'), 409);
    const order = job.orders[0];
    // Never the reason itself in the audit log: it can name people.
    await audit(db, {...(await actorOf(c)), action: 'job_rejected', target: ['job', id], meta: {paid: Boolean(order)}});
    // An edit of a live job taken down by the rejection: the directory count follows.
    await refreshActiveJobCount(db, job.company.id);

    const [to, settings] = await Promise.all([employerEmail(db, job.company.ownerUserId), getBoardSettings(db)]);
    if (to) {
      await sendBoardEmail(db, c.req.url, {
        template: 'job-rejected',
        to,
        vars: {
          boardName: settings.name,
          jobTitle: job.title,
          rejectionReason: reason,
          refundMessage: '',
          dashboardUrl: `${originOf(c.req.url)}/dashboard/employer/jobs`,
        },
      });
    }
    const paid = order ? money(order.amountCents, order.currency) : null;
    const body: ModerationResult = {
      status: 'rejected',
      message: `${job.title} was rejected.`,
      refundNote: paid ? `This job was paid for (${paid}). Refund this order in the platform dashboard if a refund is due.` : null,
    };
    return c.json(body);
  });
