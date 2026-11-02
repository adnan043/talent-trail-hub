import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS} from '../../lib/board';
import {readJobValues} from '../../lib/job-input';
import type {EmployerReceipt} from '../../lib/types-employer';
import type {Viewer} from '../../lib/types';
import {problem} from '../../platform/guards';
import {ownCompany, refreshActiveJobCount} from './employer';
import {effectiveStatus, findOwnJob, isEditable, jobData, RENEWABLE, setJobTags, listOwnJobs, toJobDetail, validateJob} from './employer-jobs';
import {chooseTier, findOwnOrder, listOwnOrders, startListing, toOrderRow} from './employer-orders';
import {submissionTarget} from './lifecycle';
import {notifyReviewers} from './review';
import {cachedBoardSettings} from './brand';

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

type Env = {Variables: {viewer: Viewer; db: PrismaClient}};

const NOT_FOUND = problem('not_found', 'No such job.');
const NO_ORDER = problem('not_found', 'No such order.');

const page = validator('query', value => ({before: typeof value.before === 'string' ? value.before.slice(0, 12) : ''}));

/** The keyset cursor: an id, or undefined for the first page. */
const cursor = (before: string) => {
  const n = Number(before);
  return before && Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

const jobBody = validator('json', value => ({job: readJobValues((value as {job?: unknown} | null)?.job)}));

const renewBody = validator('json', (value, c) => {
  const v = (value ?? {}) as Record<string, unknown>;
  const tierId = v.tierId === null || v.tierId === undefined || v.tierId === '' ? null : Number(v.tierId);
  const gateway = typeof v.gateway === 'string' && v.gateway ? v.gateway : undefined;
  if ((tierId !== null && !Number.isSafeInteger(tierId)) || (gateway && !/^[a-z0-9_-]{1,40}$/.test(gateway))) {
    return c.json(problem('invalid_input', 'That request could not be read.'), 400);
  }
  return {tierId, gateway};
});

/** The viewer's company id, or null (no company yet: nothing of theirs exists). */
const companyOf = async (db: PrismaClient, viewer: Viewer) => (await ownCompany(db, viewer.id!)) ?? null;

export const employerJobRoutes = new Hono<Env>()
  .get('/jobs', page, async c => {
    const company = await companyOf(c.var.db, c.var.viewer);
    if (!company) return c.json({items: [], nextBefore: null});
    return c.json(await listOwnJobs(c.var.db, company.id, cursor(c.req.valid('query').before), LIMITS.pageSize));
  })

  .get('/jobs/:id', async c => {
    const company = await companyOf(c.var.db, c.var.viewer);
    const job = company ? await findOwnJob(c.var.db, company.id, Number(c.req.param('id'))) : null;
    if (!job) return c.json(NOT_FOUND, 404);
    return c.json({job: toJobDetail(job)});
  })

  .put('/jobs/:id', jobBody, async c => {
    const db = c.var.db;
    const company = await companyOf(db, c.var.viewer);
    const job = company ? await findOwnJob(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !job) return c.json(NOT_FOUND, 404);
    const status = effectiveStatus(job);
    if (!isEditable(status)) return c.json(problem('not_editable', 'This job can no longer be edited.'), 409);
    const checked = await validateJob(db, c.req.valid('json').job);
    if ('fields' in checked) return c.json({...problem('invalid_input', Object.values(checked.fields)[0]!), fields: checked.fields}, 422);
    const settings = await cachedBoardSettings(db);
    // The slug never changes, so links keep working. EVERY content edit needs a review before
    // the job is (again) live: `needs_review` (cleared by an approval, or here when the board
    // publishes without review). A live job leaves the board for review now; one that is down
    // is reviewed when it is renewed (src/server/board/employer-settle.ts). Its dates stay.
    const target = await submissionTarget(db, company.id);
    const content = {...jobData(checked.columns, checked.html, settings.currency), needsReview: !(target === 'published' && status === 'published')};
    // ONE transaction: the public never sees unapproved text on a live job. When the board
    // reviews, the new content and `pending_review` land in the same write (conditional, so two
    // saves at once move it, and alert the reviewers, once).
    const reReview = await db.$transaction(async tx => {
      const t = tx as unknown as PrismaClient;
      let moved = false;
      if (status === 'published' && target === 'pending_review') {
        moved = (await t.job.updateMany({where: {id: job.id, status: 'published'}, data: {...content, status: 'pending_review'}})).count === 1;
      }
      if (!moved) await t.job.update({where: {id: job.id}, data: content, select: {id: true}});
      await setJobTags(t, job.id, checked.columns.tags);
      return moved;
    });
    if (reReview) {
      await refreshActiveJobCount(db, company.id);
      await notifyReviewers(db, c.req.url, job.id);
    }
    const saved = await findOwnJob(db, company.id, job.id);
    return c.json({job: toJobDetail(saved!), reReview});
  })

  .post('/jobs/:id/close', async c => {
    const db = c.var.db;
    const company = await companyOf(db, c.var.viewer);
    const job = company ? await findOwnJob(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !job) return c.json(NOT_FOUND, 404);
    const {count} = await db.job.updateMany({
      where: {id: job.id, companyId: company.id, status: {in: ['published', 'pending_review']}},
      data: {status: 'closed'},
    });
    if (!count) return c.json(problem('not_closable', 'Only live or in-review jobs can be closed.'), 409);
    await refreshActiveJobCount(db, company.id);
    return c.json({ok: true});
  })

  .post('/jobs/:id/renew', renewBody, async c => {
    const db = c.var.db;
    const company = await companyOf(db, c.var.viewer);
    const job = company ? await findOwnJob(db, company.id, Number(c.req.param('id'))) : null;
    if (!company || !job) return c.json(NOT_FOUND, 404);
    if (company.isBlocked) return c.json(problem('company_blocked', 'This company cannot post jobs. Contact the board for help.'), 403);
    if (!RENEWABLE.includes(effectiveStatus(job))) return c.json(problem('not_renewable', 'Only live, expired or closed jobs can be renewed.'), 409);
    // A job that was never approved (closed while in review) cannot be renewed onto the board.
    if (!job.publishedAt) return c.json(problem('not_renewable', 'This job was never live, so it cannot be renewed. Post it again instead.'), 409);
    const input = c.req.valid('json');
    const chosen = await chooseTier(db, await cachedBoardSettings(db), input.tierId);
    if ('field' in chosen) return c.json({...problem('invalid_input', chosen.field), fields: {tierId: chosen.field}}, 422);
    if ('unavailable' in chosen) return c.json(problem(chosen.status === 409 ? 'tier_not_priced' : 'posting_unavailable', chosen.unavailable), chosen.status);
    // An earlier renewal checkout for this job is superseded (`failed`): only the newest one may
    // extend it; a late payment of an old one is flagged for a refund by the payment hook.
    await db.listingOrder.updateMany({where: {jobId: job.id, kind: 'renew', status: 'pending'}, data: {status: 'failed'}});
    const answer = await startListing(db, c.req.url, {
      companyId: company.id,
      viewer: c.var.viewer,
      jobId: job.id,
      kind: 'renew',
      tier: chosen.tier,
      gateway: input.gateway,
      cancelPath: '/dashboard/employer/jobs',
    });
    if ('problem' in answer) return c.json(problem(answer.problem.code, answer.problem.message), answer.problem.status);
    return c.json(answer);
  })

  .get('/orders', page, async c => {
    const company = await companyOf(c.var.db, c.var.viewer);
    if (!company) return c.json({items: [], nextBefore: null});
    return c.json(await listOwnOrders(c.var.db, company.id, cursor(c.req.valid('query').before), LIMITS.pageSize));
  })

  .get('/orders/:id', async c => {
    const db = c.var.db;
    const company = await companyOf(db, c.var.viewer);
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
