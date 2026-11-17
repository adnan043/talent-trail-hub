import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS, isDbId} from '../../lib/board';
import {readJobValues} from '../../lib/job-input';
import type {EmployerReceipt} from '../../lib/types-employer';
import {problem} from '../../platform/guards';
import {BLOCKED, type EmployerEnv, refreshActiveJobCount} from './employer';
import {effectiveStatus, findOwnJob, isEditable, jobData, RENEWABLE, setJobTags, listOwnJobs, toJobDetail, validateJob} from './employer-jobs';
import {RENEW_AHEAD_MAX_DAYS} from './employer-settle';
import {chooseTier, findOwnOrder, listOwnOrders, startListing, toOrderRow} from './employer-orders';
import {submissionTarget} from './lifecycle';
import {notifyReviewers} from './review';
import {after} from './after';
import {cachedBoardSettings} from './brand';
import {forgetPublicLists} from './public-cache';
import {getBoardSettings} from './settings';
import {POSTS_PER_HOUR, userAttemptAllowed} from './employer-logo';

/**
 * The employer's jobs and orders: `/site-api/employer/jobs…`, `/site-api/employer/orders…`.
 * Mounted INSIDE `employerRoutes` (src/server/routes/employer.ts), whose guards run first
 * (signed in, verified, database, not single-company). Every handler starts from the viewer's
 * own company; another company's job or order is a 404, like one that does not exist.
 *
 *   GET  /jobs?before=          my jobs, newest first (F15)
 *   GET  /jobs/:id              one job as the form edits it
 *   PUT  /jobs/:id              {job}: save; a live job goes back to review when the board says so
 *   POST /jobs/:id/close        close as filled
 *   POST /jobs/:id/renew        {tierId, gateway?}: a new order for one more period
 *   GET  /orders?before=        billing (F18): paid and refunded orders, newest first
 *   GET  /orders/:id            a printable receipt
 */

type Env = EmployerEnv;

/** How far ahead a renewal may push a listing's end date (twice the longest listing option). */
const NOT_FOUND = problem('not_found', 'No such job.');
const NO_ORDER = problem('not_found', 'No such order.');

const page = validator('query', value => ({before: typeof value.before === 'string' ? value.before.slice(0, 12) : ''}));

/** The keyset cursor: an id, or undefined for the first page. */
const cursor = (before: string) => {
  const n = Number(before);
  return before && isDbId(n) ? n : undefined;
};

const jobBody = validator('json', value => ({job: readJobValues((value as {job?: unknown} | null)?.job)}));

const renewBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const tierId = v.tierId === null || v.tierId === undefined || v.tierId === '' ? null : Number(v.tierId);
  const gateway = typeof v.gateway === 'string' && v.gateway ? v.gateway : undefined;
  if ((tierId !== null && !isDbId(tierId)) || (gateway && !/^[a-z0-9_-]{1,40}$/.test(gateway))) {
    return c.json(problem('invalid_input', 'That request could not be read.'), 400);
  }
  return {tierId, gateway};
});

export const employerJobRoutes = new Hono<Env>()
  .get('/jobs', page, async c => {
    const company = c.var.employerCompany;
    if (!company) return c.json({items: [], nextBefore: null});
    return c.json(await listOwnJobs(c.var.db, company.id, cursor(c.req.valid('query').before), LIMITS.pageSize));
  })

  .get('/jobs/:id', async c => {
    const company = c.var.employerCompany;
    const job = company ? await findOwnJob(c.var.db, company.id, Number(c.req.param('id'))) : null;
    if (!job) return c.json(NOT_FOUND, 404);
    return c.json({job: toJobDetail(job)});
  })

  .put('/jobs/:id', jobBody, async c => {
    const db = c.var.db;
    const company = c.var.employerCompany;
    const job = company ? await findOwnJob(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !job) return c.json(NOT_FOUND, 404);
    if (company.isBlocked) return c.json(BLOCKED, 403);
    const status = effectiveStatus(job);
    if (!isEditable(status)) return c.json(problem('not_editable', 'This job can no longer be edited.'), 409);
    // The settings from the database, never the Site Cache: they decide whether the edit skips review.
    // The job's own category stays valid although the admin hid it since (as the admin's edit does).
    const [checked, settings] = await Promise.all([validateJob(db, c.req.valid('json').job, job.categoryId), getBoardSettings(db)]);
    if ('fields' in checked) return c.json({...problem('invalid_input', Object.values(checked.fields)[0]!), fields: checked.fields}, 422);
    // The slug never changes, so links keep working. EVERY content edit needs a review before
    // the job is (again) live: `needs_review` (cleared by an approval, or here when the board
    // publishes without review). A live job leaves the board for review now; one that is down
    // is reviewed when it is renewed (src/server/board/employer-settle.ts). Its dates stay.
    const target = await submissionTarget(db, company.id, settings);
    // A salary keeps the currency it was entered in (the form showed it); only a job without one takes the board's.
    const base = jobData(checked.columns, checked.html, job.salaryCurrency ?? settings.currency);
    // ONE transaction, the job row LOCKED and its status read again under the lock: an approval,
    // a renewal or a payment that lands while this request runs is either fully before this write
    // (seen here) or waits for it (and sees `needs_review`). So unapproved text never goes live.
    // When the board reviews, the new content and `pending_review` land in the same write.
    const reReview = await db.$transaction(async tx => {
      const t = tx as unknown as PrismaClient;
      const [row] = await t.$queryRaw<{status: string; expiresAt: Date | null}[]>`
        SELECT "status", "expires_at" AS "expiresAt" FROM "jobs" WHERE "id" = ${job.id} FOR UPDATE`;
      if (!row) return null;
      const current = effectiveStatus(row);
      if (!isEditable(current)) return null;
      const content = {...base, needsReview: !(target === 'published' && current === 'published')};
      const moved = current === 'published' && target === 'pending_review';
      await t.job.update({where: {id: job.id}, data: moved ? {...content, status: 'pending_review'} : content, select: {id: true}});
      await setJobTags(t, job.id, checked.columns.tags);
      return moved;
    });
    if (reReview === null) return c.json(problem('not_editable', 'This job can no longer be edited.'), 409);
    // It left the board (re-review) or its live text changed: its company's count and the public
    // lists now; the reviewers' email after the answer (the employer never waits for the mail service).
    // The count first, then the lists (a list refilled in between would hold the old count);
    // the job's fresh copy for the answer alongside.
    const [saved] = await Promise.all([
      findOwnJob(db, company.id, job.id),
      (async () => {
        if (reReview) await refreshActiveJobCount(db, company.id);
        if (status === 'published') await forgetPublicLists();
      })(),
    ]);
    if (reReview) {
      const requestUrl = c.req.url;
      after(c, `review alert for job ${job.id}`, () => notifyReviewers(db, requestUrl, job.id));
    }
    return c.json({job: toJobDetail(saved!), reReview});
  })

  .post('/jobs/:id/close', async c => {
    const db = c.var.db;
    const company = c.var.employerCompany;
    const job = company ? await findOwnJob(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !job) return c.json(NOT_FOUND, 404);
    // A live job past its end date is expired (before the sweep ran): not closed here, so its
    // renewal takes the normal expired path. An unpaid job (checkout never finished) can be closed.
    const now = new Date();
    const {count} = await db.job.updateMany({
      where: {
        id: job.id,
        companyId: company.id,
        OR: [{status: {in: ['pending_review', 'pending_payment']}}, {status: 'published', OR: [{expiresAt: null}, {expiresAt: {gt: now}}]}],
      },
      data: {status: 'closed'},
    });
    if (!count) return c.json(problem('not_closable', 'Only live, in-review or unpaid jobs can be closed.'), 409);
    // Its open checkouts will not be fulfilled: a late payment of one is flagged for a refund.
    if (job.status === 'pending_payment') await db.listingOrder.updateMany({where: {jobId: job.id, status: 'pending'}, data: {status: 'failed'}});
    await refreshActiveJobCount(db, company.id);
    await forgetPublicLists();
    return c.json({ok: true});
  })

  .post('/jobs/:id/renew', renewBody, async c => {
    const db = c.var.db;
    if (!(await userAttemptAllowed(db, 'post', c.var.viewer.id!, POSTS_PER_HOUR))) {
      return c.json(problem('rate_limited', 'Too many jobs posted or renewed in the last hour. Try again later.'), 429);
    }
    const company = c.var.employerCompany;
    const job = company ? await findOwnJob(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !job) return c.json(NOT_FOUND, 404);
    if (company.isBlocked) return c.json(BLOCKED, 403);
    if (!RENEWABLE.includes(effectiveStatus(job))) return c.json(problem('not_renewable', 'Only live, expired or closed jobs can be renewed.'), 409);
    // A job that was never approved (closed while in review) cannot be renewed onto the board.
    if (!job.publishedAt) return c.json(problem('not_renewable', 'This job was never live, so it cannot be renewed. Post it again instead.'), 409);
    const input = c.req.valid('json');
    // What is charged (free posting on or off) comes from the database, never the cache.
    const chosen = await chooseTier(db, await getBoardSettings(db), input.tierId);
    if ('field' in chosen) return c.json({...problem('invalid_input', chosen.field), fields: {tierId: chosen.field}}, 422);
    if ('unavailable' in chosen) return c.json(problem(chosen.status === 409 ? 'tier_not_priced' : 'posting_unavailable', chosen.unavailable), chosen.status);
    // Renewals stack on the time left: never more than RENEW_AHEAD_MAX_DAYS ahead, so free posting
    // (or a handful of cheap renewals) can't book a listing, featured, for years.
    const running = ['published', 'pending_review'].includes(effectiveStatus(job));
    const left = running && job.expiresAt ? Math.max(0, job.expiresAt.getTime() - Date.now()) / 86_400_000 : 0;
    if (left + chosen.tier.durationDays > RENEW_AHEAD_MAX_DAYS) {
      return c.json(problem('renewed_enough', `This job is already listed for ${Math.ceil(left)} more days. Renew it closer to its end date.`), 409);
    }
    const answer = await startListing(db, c.req.url, {
      companyId: company.id,
      viewer: c.var.viewer,
      jobId: job.id,
      kind: 'renew',
      tier: chosen.tier,
      gateway: input.gateway,
      cancelPath: '/dashboard/employer/jobs',
      defer: work => after(c, `listing emails for job ${job.id}`, work),
    });
    if ('problem' in answer) return c.json(problem(answer.problem.code, answer.problem.message), answer.problem.status);
    // Once a new order exists, an earlier renewal checkout for this job is superseded (`failed`):
    // only the newest one may extend it; a late payment of an old one is flagged for a refund by
    // the payment hook. No new order (choose a way to pay, an error): the earlier one stays open.
    if (answer.status !== 'choose') {
      await db.listingOrder.updateMany({where: {jobId: job.id, kind: 'renew', status: 'pending', id: {not: answer.orderId}}, data: {status: 'failed'}});
    }
    return c.json(answer);
  })

  .get('/orders', page, async c => {
    const company = c.var.employerCompany;
    if (!company) return c.json({items: [], nextBefore: null});
    return c.json(await listOwnOrders(c.var.db, company.id, cursor(c.req.valid('query').before), LIMITS.pageSize));
  })

  .get('/orders/:id', async c => {
    const db = c.var.db;
    const company = c.var.employerCompany;
    const order = company ? await findOwnOrder(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !order) return c.json(NO_ORDER, 404);
    const [settings, buyer] = await Promise.all([
      cachedBoardSettings(db),
      order.userId ? db.user.findUnique({where: {id: order.userId}, select: {name: true, email: true}}) : null,
    ]);
    // The buyer's own name and email only when the buyer is the viewer (a later owner of the
    // company sees the order, not someone else's address).
    const mine = order.userId === c.var.viewer.id;
    const receipt: EmployerReceipt = {
      order: toOrderRow(order),
      refundedAt: order.refundedAt?.toISOString() ?? null,
      boardName: settings.name,
      company: {name: company.name, location: company.location},
      buyer: mine && buyer ? {name: buyer.name, email: buyer.email} : {name: null, email: null},
    };
    return c.json({receipt});
  });
