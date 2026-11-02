import {flagForRefund, refundListingOrder, settleListingOrder} from './board/employer-settle';
import {config} from '../platform/config';
import {getDb} from '../platform/db';
import {type Checkout, definePaymentHooks, type PlatformMembership, type Refund} from '../platform/payments';

/**
 * What this site does when money moves (docs/agent/payments.md). YOURS to change.
 *
 * Called with the platform's signed payment events (the live site) and by the thanks page's
 * confirm (`GET /site-api/checkout/:id`, everywhere, the Preview too). So a hook can run MORE THAN
 * ONCE for one payment: the defaults below upsert and say whether the row is new (`created`). Do
 * one-time work (a welcome email, a stock change) only when it is: `if (created) { … }`.
 *
 * Throw to have the event tried again later (1 min, 2 min, 10 min, 1 h). Keep each hook short:
 * slow work goes in a background job (`sendJob`, docs/agent/background-jobs.md).
 */

const userIdOf = (ref: string | null | undefined): number | null => {
  const n = Number(ref);
  return ref && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const dateOf = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

function database() {
  const db = getDb();
  // No Site Database: throwing makes the platform try again once there is one.
  if (!db) throw new Error('No Site Database: the payment is kept by the platform and sent again.');
  return db;
}

/** Records a paid checkout once. `created` is true the first time. */
export async function recordOrder(checkout: Checkout, status: 'paid' | 'failed'): Promise<{created: boolean}> {
  const db = database();
  const data = {
    priceKey: checkout.price,
    mode: checkout.mode,
    email: checkout.email?.toLowerCase() ?? null,
    userId: userIdOf(checkout.customerRef),
    quantity: checkout.quantity,
    amountCents: checkout.amountCents,
    currency: checkout.currency,
    metadata: checkout.metadata ?? {},
    paidAt: dateOf(checkout.paidAt),
  };
  const found = await db.order.findUnique({where: {checkoutId: checkout.id}, select: {id: true, status: true}});
  if (found) {
    // Never move a refunded order back to paid, or a paid one to failed.
    if (found.status === 'failed' && status === 'paid') await db.order.update({where: {id: found.id}, data: {...data, status}});
    return {created: false};
  }
  try {
    await db.order.create({data: {checkoutId: checkout.id, status, ...data}});
    return {created: true};
  } catch (error) {
    // P2002: the event and the confirm arrived together; the other one wrote it.
    if ((error as {code?: unknown} | null)?.code === 'P2002') return {created: false};
    throw error;
  }
}

/** Keeps the site's copy of one membership in step. `created` is true the first time. */
export async function recordMembership(membership: PlatformMembership, mode: string): Promise<{created: boolean}> {
  const db = database();
  const data = {
    priceKey: membership.price,
    mode,
    email: membership.email?.toLowerCase() ?? null,
    userId: userIdOf(membership.customerRef),
    status: membership.status,
    currentPeriodEnd: dateOf(membership.currentPeriodEnd),
    accessEndsAt: dateOf(membership.accessEndsAt),
  };
  const found = await db.membership.findUnique({where: {subscriptionId: membership.id}, select: {id: true}});
  if (found) {
    await db.membership.update({where: {id: found.id}, data});
    return {created: false};
  }
  try {
    await db.membership.create({data: {subscriptionId: membership.id, ...data}});
    return {created: true};
  } catch (error) {
    if ((error as {code?: unknown} | null)?.code === 'P2002') {
      await db.membership.update({where: {subscriptionId: membership.id}, data});
      return {created: false};
    }
    throw error;
  }
}

/** The site's address, for the links in the board's emails (a hook has no request). */
const siteAddress = () => config.siteUrl ?? 'https://localhost';

/**
 * The job board's side of a paid checkout (F12): the LISTING ORDER this site created for the
 * checkout, found by the checkout id the platform reports (NEVER by the browser's metadata), is
 * settled once: paid, then its job goes live or into review (new) or gets one more period
 * (renew). A checkout for another price than the order's is left alone (logged).
 */
export async function settleListingCheckout(checkout: Checkout): Promise<void> {
  const db = database();
  const order = await db.listingOrder.findUnique({
    where: {checkoutId: checkout.id},
    select: {id: true, priceKey: true, status: true, amountCents: true, currency: true},
  });
  if (!order || order.status === 'paid' || order.status === 'refunded') return;
  if (order.status === 'failed') {
    // Superseded (the employer started another checkout for the job) or failed earlier, then paid.
    await flagForRefund(db, order.id, 'a superseded or failed checkout was paid');
    return;
  }
  if (order.priceKey && order.priceKey !== checkout.price) {
    console.error(`[payments] listing order ${order.id}: paid price ${checkout.price} is not ${order.priceKey}; left pending`);
    return;
  }
  // The catalogue decides the amount; a difference from the tier's display copy is only logged.
  if (checkout.amountCents !== order.amountCents || checkout.currency.toUpperCase() !== order.currency) {
    console.warn(
      `[payments] listing order ${order.id}: charged ${checkout.amountCents} ${checkout.currency}, the tier showed ${order.amountCents} ${order.currency}`
    );
  }
  await settleListingOrder(db, siteAddress(), {checkoutId: checkout.id}, {
    amountCents: checkout.amountCents,
    currency: checkout.currency,
    paidAt: dateOf(checkout.paidAt),
  });
}

export const paymentHooks = definePaymentHooks({
  async onCheckoutPaid(checkout) {
    await recordOrder(checkout, 'paid');
    // Idempotent by itself: only a PENDING listing order moves.
    await settleListingCheckout(checkout);
  },

  async onCheckoutFailed(checkout) {
    await recordOrder(checkout, 'failed');
    await database().listingOrder.updateMany({where: {checkoutId: checkout.id, status: 'pending'}, data: {status: 'failed'}});
  },

  async onMembershipChanged(membership, event) {
    await recordMembership(membership, event.mode);
  },

  async onRefund(refund: Refund) {
    const db = database();
    await db.order.updateMany({
      where: {checkoutId: refund.checkoutId},
      data: {status: refund.full ? 'refunded' : 'partially_refunded'},
    });
    // The listing order: refunded when the whole payment was (a partial refund is bookkeeping).
    // A full refund also takes the listing down: unreviewed → rejected, live → closed.
    if (refund.full) await refundListingOrder(db, refund.checkoutId, dateOf(refund.refundedAt) ?? new Date());
  },
});
