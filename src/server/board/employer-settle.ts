import type {PrismaClient} from '../../generated/prisma/client';
import {audit} from '../../platform/auth';
import {refreshActiveJobCount} from './employer';
import {notifySettled} from './employer-notify';
import {publishJob, submissionTarget} from './lifecycle';

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
 *           closed, or edited → as `submissionTarget` says, into review with its new
 *           dates when the board reviews (approval keeps them); in review → new dates, still
 *           in review; rejected or anything else → left alone, the order flagged for a refund.
 * A job published here has `needs_review` cleared; only a review (D) clears it otherwise.
 */

const DAY_MS = 86_400_000;

/** A paid order that cannot do what was bought: logged and in the activity log for the admin to refund. */
export async function flagForRefund(db: PrismaClient, orderId: number, reason: string): Promise<void> {
  // Once per order: a retried event or a reloaded thanks page must not add a second row (a
  // second row reads as a second refund to make).
  const flagged = await db.auditEvent.findFirst({
    where: {targetType: 'listing_order', targetId: String(orderId), action: 'listing_order.refund_needed'},
    select: {id: true},
  });
  if (flagged) return;
  console.error(`[payments] listing order ${orderId}: ${reason}; refund it in the platform dashboard`);
  await audit(db, {actorUserId: null, action: 'listing_order.refund_needed', target: ['listing_order', orderId], meta: {reason}});
}

export async function settleListingOrder(
  db: PrismaClient,
  requestUrl: string,
  where: {id: number} | {checkoutId: string},
  payment: {amountCents?: number; currency?: string; paidAt?: Date | null}
) {
  const now = new Date();
  const outcome = await db.$transaction(async tx => {
    const t = tx as unknown as PrismaClient;
    const claimed = await t.listingOrder.updateMany({
      where: {...where, status: 'pending'},
      data: {
        status: 'paid',
        paidAt: payment.paidAt ?? now,
        ...(payment.amountCents !== undefined ? {amountCents: payment.amountCents} : {}),
        ...(payment.currency ? {currency: payment.currency.toUpperCase().slice(0, 3)} : {}),
      },
    });
    if (claimed.count === 0) return null;
    const order = await t.listingOrder.findFirstOrThrow({
      where,
      select: {id: true, kind: true, jobId: true, tierId: true, companyId: true, userId: true, durationDays: true, includesFeatured: true, amountCents: true, currency: true, tierName: true},
    });
    const job = order.jobId
      ? await t.job.findUnique({where: {id: order.jobId}, select: {id: true, status: true, publishedAt: true, expiresAt: true, needsReview: true, isFeatured: true, featuredUntil: true}})
      : null;
    if (!job) return {order, job: null, moved: false, refund: 'its job no longer exists'};
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
      if (live || job.status === 'pending_review') {
        await t.job.update({where: {id: job.id}, data: period, select: {id: true}});
      } else if (down) {
        // Edited since its approval, or CLOSED (by the employer or the board's admin: the two are
        // not told apart, so a closed job is always re-checked): as a new post would be.
        const target = job.needsReview || job.status === 'closed' ? await submissionTarget(t, order.companyId) : 'published';
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
      const target = await submissionTarget(t, order.companyId);
      if (target === 'published') {
        await publishJob(t, job.id, {from: ['pending_payment', 'draft'], now});
        await t.job.update({where: {id: job.id}, data: {needsReview: false}, select: {id: true}});
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
    return {order, job: after, moved, refund};
  });
  if (!outcome) return null;
  if (outcome.refund && outcome.order.amountCents > 0) await flagForRefund(db, outcome.order.id, outcome.refund);
  await notifySettled(db, requestUrl, outcome);
  return {orderId: outcome.order.id, jobStatus: outcome.job?.status ?? null};
}

/**
 * A FULL refund (F12), in ONE transaction so a retried event finishes what a failed one began:
 * the order is refunded once, and its job leaves the board (in review → rejected, live → closed).
 */
export async function refundListingOrder(db: PrismaClient, checkoutId: string, refundedAt: Date): Promise<void> {
  await db.$transaction(async tx => {
    const t = tx as unknown as PrismaClient;
    const {count} = await t.listingOrder.updateMany({where: {checkoutId, status: 'paid'}, data: {status: 'refunded', refundedAt}});
    if (!count) return;
    const order = await t.listingOrder.findUniqueOrThrow({where: {checkoutId}, select: {jobId: true, companyId: true}});
    if (!order.jobId) return;
    await t.job.updateMany({where: {id: order.jobId, status: 'pending_review'}, data: {status: 'rejected', rejectionReason: 'Payment refunded'}});
    await t.job.updateMany({where: {id: order.jobId, status: 'published'}, data: {status: 'closed'}});
    await refreshActiveJobCount(t, order.companyId);
  });
}
