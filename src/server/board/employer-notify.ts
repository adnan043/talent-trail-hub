import type {PrismaClient} from '../../generated/prisma/client';
import {formatDate, formatMoney} from '../../lib/format';
import {sendBoardEmail} from './email';
import {notifyReviewers} from './review';

/**
 * After a listing order is settled (src/server/board/employer-orders.ts), once: the buyer's
 * receipt (paid orders), "your job is live" or "we received your job", and the reviewers' alert.
 * Links are site paths; the email renderer makes them absolute.
 */

export const orderNumber = (id: number) => `TT-${String(id).padStart(6, '0')}`;

export type Settled = {
  /** The job changed state in this settle (live now, or into review). False: only its dates moved, or nothing. */
  moved: boolean;
  order: {id: number; kind: string; userId: number | null; amountCents: number; currency: string; tierName: string};
  job: {id: number; title: string; slug: string; status: string; expiresAt: Date | null} | null;
};

export async function notifySettled(db: PrismaClient, requestUrl: string, {order, job, moved}: Settled): Promise<void> {
  const buyer = order.userId ? await db.user.findUnique({where: {id: order.userId}, select: {email: true}}) : null;
  if (buyer?.email && order.amountCents > 0) {
    await sendBoardEmail(db, requestUrl, {
      template: 'order-receipt',
      to: buyer.email,
      vars: {
        orderNumber: orderNumber(order.id),
        orderItems: `${order.tierName}${order.kind === 'renew' ? ' (renewal)' : ''}: ${job?.title ?? 'Job listing'}`,
        orderTotal: formatMoney(order.amountCents, order.currency),
        receiptUrl: `/dashboard/employer/billing/${order.id}/receipt`,
        billingUrl: '/dashboard/employer/billing',
      },
    });
  }
  if (!job) return;
  if (!moved) return;
  if (job.status === 'published' && buyer?.email) {
    await sendBoardEmail(db, requestUrl, {
      template: 'job-approved',
      to: buyer.email,
      vars: {jobTitle: job.title, jobUrl: `/jobs/${job.slug}/`, expiresOn: formatDate(job.expiresAt?.toISOString() ?? null)},
    });
  } else if (job.status === 'pending_review') {
    if (buyer?.email) {
      await sendBoardEmail(db, requestUrl, {
        template: 'job-submitted',
        to: buyer.email,
        vars: {jobTitle: job.title, statusMessage: "It's waiting for a quick review. We'll email you as soon as it's live.", dashboardUrl: '/dashboard/employer/jobs'},
      });
    }
    await notifyReviewers(db, requestUrl, job.id);
  }
}

