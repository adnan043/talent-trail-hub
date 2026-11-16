import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS} from '../../lib/board';
import {audit} from '../../platform/auth';
import {refreshActiveJobCount} from './employer';
import {notifySettled} from './employer-notify';
import {publishJob, submissionTarget} from './lifecycle';
import {forgetPublicLists} from './public-cache';
import {getBoardSettings} from './settings';

/**
 * Settling a listing order (F12, F15 renew, F25 free posting): the ONE place a paid order moves
 * its job. Marks a PENDING order paid and moves the job in one transaction, once: a second call
 * (a retried event, the thanks page's confirm, a double click) finds no pending order and does
 * nothing. Emails and the reviewers' alert go after the commit.
 *
 * Moderation is never skipped by paying:
 *   new     pending_payment → live or review, as `submissionTarget` says
 *   renew   live → the new days added to the days left (stays live; it was approved);
 *           expired → live again, unless it was edited since its approval (`needs_review`);
 *           closed by the board's admin → always into review (also in `auto` mode);
 *           closed, or edited → as `submissionTarget` says, into review with its new
 *           dates when the board reviews (approval keeps them); in review → new dates, still
 *           in review; rejected or anything else → left alone, the order flagged for a refund.
 * A job published here has `needs_review` cleared; only a review (D) clears it otherwise.
 */

const DAY_MS = 86_400_000;

/**
 * Renewals stack on the time left, never more than this many days ahead. The renew route checks it
 * first (a clear answer); settling checks it AGAIN under the job's lock, so renewals started at the
 * same moment (each saw the same days left) can't stack past it.
 */
export const RENEW_AHEAD_MAX_DAYS = 2 * LIMITS.tierDaysMax;

/**
 * Whether the board's admin closed this job and has not listed it again since: the admin's close
 * and extend are audited (`job_closed`, `job_extended`), the employer's own close is not.
 */
async function closedByBoard(t: PrismaClient, jobId: number): Promise<boolean> {
  const last = await t.auditEvent.findFirst({
    where: {targetType: 'job', targetId: String(jobId), action: {in: ['job_closed', 'job_extended']}},
    orderBy: {id: 'desc'},
    select: {action: true},
  });
  return last?.action === 'job_closed';
}

const REFUND_FLAG = 'listing_order.refund_needed';

/** Whether this order was flagged for a refund: it was paid but never moved its job. */
async function isFlagged(t: PrismaClient, orderId: number): Promise<boolean> {
  const row = await t.auditEvent.findFirst({where: {targetType: 'listing_order', targetId: String(orderId), action: REFUND_FLAG}, select: {id: true}});
  return row !== null;
}

/**
 * Inside a transaction: flags the order once. The advisory lock on the order makes the look and
 * the write one step, so a webhook and a confirm at the same moment still add ONE row (a second
 * row reads as a second refund to make).
 */
async function flagInTransaction(t: PrismaClient, orderId: number, reason: string): Promise<void> {
  await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${REFUND_FLAG}:${orderId}`}))`;
  if (await isFlagged(t, orderId)) return;
  console.error(`[payments] listing order ${orderId}: ${reason}; refund it in the platform dashboard`);
  await audit(t, {actorUserId: null, action: REFUND_FLAG, target: ['listing_order', orderId], meta: {reason}});
}

/** A paid order that cannot do what was bought: logged and in the activity log for the admin to refund. */
export async function flagForRefund(db: PrismaClient, orderId: number, reason: string): Promise<void> {
  await db.$transaction(tx => flagInTransaction(tx as unknown as PrismaClient, orderId, reason));
}

/**
 * `defer`: how to send the emails after the answer (a route passes `work => after(c, …, work)`,
 * src/server/board/after.ts). Without it (the payment hook: no request to answer) they are awaited,
 * so the work always completes.
 */
export async function settleListingOrder(
  db: PrismaClient,
  requestUrl: string,
  where: {id: number} | {checkoutId: string},
  payment: {amountCents?: number; currency?: string; paidAt?: Date | null},
  options: {defer?: (work: () => Promise<unknown>) => void} = {}
) {
  const now = new Date();
  // The moderation mode: from the database, never the Site Cache (it decides whether a paid job
  // skips review). Read BEFORE the transaction: no other query may run on this request's
  // connection while it is open, and none runs while the order and job are locked.
  const settings = await getBoardSettings(db);
  const outcome = await db.$transaction(async tx => {
    const t = tx as unknown as PrismaClient;
    // Claimed and read in ONE statement (UPDATE … RETURNING): only a PENDING order moves, once.
    const [order] = await t.listingOrder.updateManyAndReturn({
      where: {...where, status: 'pending'},
      data: {
        status: 'paid',
        paidAt: payment.paidAt ?? now,
        ...(payment.amountCents !== undefined ? {amountCents: payment.amountCents} : {}),
        ...(payment.currency ? {currency: payment.currency.toUpperCase().slice(0, 3)} : {}),
      },
      select: {id: true, kind: true, jobId: true, tierId: true, companyId: true, userId: true, durationDays: true, includesFeatured: true, amountCents: true, currency: true, tierName: true},
    });
    if (!order) return null;
    // Locked, so an employer edit running now is fully before this read (its `needs_review`
    // seen here) or waits until this commits (and sees the new status).
    if (order.jobId) await t.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${order.jobId} FOR UPDATE`;
    const job = order.jobId
      ? await t.job.findUnique({where: {id: order.jobId}, select: {id: true, status: true, publishedAt: true, expiresAt: true, needsReview: true, isFeatured: true, featuredUntil: true}})
      : null;
    if (!job) {
      if (order.amountCents > 0) await flagInTransaction(t, order.id, 'its job no longer exists');
      return {order, job: null, moved: false, refund: 'its job no longer exists'};
    }
    let moved = false;
    let refund: string | null = null;
    if (order.kind === 'renew') {
      const live = job.status === 'published' && job.expiresAt !== null && job.expiresAt > now;
      const down = job.status === 'expired' || job.status === 'closed' || (job.status === 'published' && !live);
      // Still running (live, or in review with time left): the new days are ADDED to what is left,
      // as the admin's extend does. Down: a fresh period from now.
      const running = (live || job.status === 'pending_review') && job.expiresAt !== null && job.expiresAt > now;
      const expiresAt = new Date((running ? job.expiresAt!.getTime() : now.getTime()) + order.durationDays * DAY_MS);
      // Featured days are added to featuring still running, else start now; never past the listing.
      const featuredFrom = job.isFeatured && job.featuredUntil && job.featuredUntil > now ? job.featuredUntil : now;
      const featuredUntil = new Date(
        Math.min(featuredFrom.getTime() + order.durationDays * DAY_MS, expiresAt.getTime())
      );
      const period = {
        expiresAt,
        durationDays: order.durationDays,
        tierId: order.tierId,
        expiryReminderSentAt: null,
        ...(order.includesFeatured ? {isFeatured: true, featuredUntil, listingFeatured: true} : {}),
      };
      if (running && expiresAt.getTime() > now.getTime() + RENEW_AHEAD_MAX_DAYS * DAY_MS) {
        // Another renewal settled first: this one would book the listing too far ahead.
        refund = `a renewal would list the job more than ${RENEW_AHEAD_MAX_DAYS} days ahead`;
      } else if (live || job.status === 'pending_review') {
        await t.job.update({where: {id: job.id}, data: period, select: {id: true}});
      } else if (down) {
        // Edited since its approval, or closed: as a new post would be. Closed by the board's
        // admin: always into review, so renewing never undoes the admin's close by itself.
        const target =
          job.status === 'closed' && (await closedByBoard(t, job.id))
            ? 'pending_review'
            : job.needsReview || job.status === 'closed'
              ? await submissionTarget(t, order.companyId, settings)
              : 'published';
        await t.job.update({
          where: {id: job.id},
          data: {...period, status: target, publishedAt: now, rejectionReason: null, needsReview: target !== 'published'},
          select: {id: true},
        });
        moved = true;
      } else {
        refund = `a renewal was paid for a job that is ${job.status}`;
      }
    } else if (job.status === 'pending_payment' || job.status === 'draft') {
      await t.job.update({
        where: {id: job.id},
        data: {durationDays: order.durationDays, listingFeatured: order.includesFeatured, tierId: order.tierId, source: order.amountCents > 0 ? 'paid' : 'free'},
        select: {id: true},
      });
      const target = await submissionTarget(t, order.companyId, settings);
      if (target === 'published') {
        await publishJob(t, job.id, {from: ['pending_payment', 'draft'], now, needsReview: false});
      } else {
        // Into review: it must be approved before it is ever live (also after a close and renew).
        await t.job.updateMany({where: {id: job.id, status: {in: ['pending_payment', 'draft']}}, data: {status: 'pending_review', needsReview: true}});
      }
      moved = true;
    } else {
      refund = `a new listing was paid for a job that is already ${job.status}`;
    }
    await refreshActiveJobCount(t, order.companyId, now);
    const after = await t.job.findUnique({where: {id: job.id}, select: {id: true, title: true, slug: true, status: true, expiresAt: true}});
    // In the same transaction as the claim: a crash after the commit can never lose the flag.
    if (refund && order.amountCents > 0) await flagInTransaction(t, order.id, refund);
    return {order, job: after, moved, refund};
  });
  if (!outcome) return null;
  // After the commit: the job may have gone live, been featured, or got new dates.
  if (outcome.job) await forgetPublicLists();
  // The receipt, the "live" / "in review" email and the reviewers' alert.
  if (options.defer) options.defer(() => notifySettled(db, requestUrl, outcome));
  else await notifySettled(db, requestUrl, outcome);
  return {orderId: outcome.order.id, jobStatus: outcome.job?.status ?? null};
}

/**
 * A FULL refund (F12), in ONE transaction so a retried event finishes what a failed one began:
 * the order is refunded once, and its job leaves the board (in review → rejected, live → closed).
 */
export async function refundListingOrder(db: PrismaClient, checkoutId: string, refundedAt: Date): Promise<void> {
  await db.$transaction(async tx => {
    const t = tx as unknown as PrismaClient;
    // Refunded BEFORE it was settled (the paid event failed, came late, or the confirm never ran):
    // closed for good, so a later paid event or confirm can never publish a job whose money is back.
    await t.listingOrder.updateMany({where: {checkoutId, status: {in: ['pending', 'failed']}}, data: {status: 'refunded', refundedAt}});
    const {count} = await t.listingOrder.updateMany({where: {checkoutId, status: 'paid'}, data: {status: 'refunded', refundedAt}});
    if (!count) return;
    const order = await t.listingOrder.findUniqueOrThrow({where: {checkoutId}, select: {id: true, jobId: true, companyId: true}});
    // A flagged order never moved its job (a duplicate post, a renewal of a rejected job…): the
    // listing another order paid for stays up when this one is refunded, as the flag asked.
    if (!order.jobId || (await isFlagged(t, order.id))) return;
    await t.job.updateMany({where: {id: order.jobId, status: 'pending_review'}, data: {status: 'rejected', rejectionReason: 'Payment refunded'}});
    await t.job.updateMany({where: {id: order.jobId, status: 'published'}, data: {status: 'closed'}});
    await refreshActiveJobCount(t, order.companyId);
  });
}
