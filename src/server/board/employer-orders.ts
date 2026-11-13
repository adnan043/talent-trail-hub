import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS, isDbId} from '../../lib/board';
import type {EmployerOrderRow, ListingAnswer, TierOption} from '../../lib/types-employer';
import type {Viewer} from '../../lib/types';
import {SiteKeyMissing} from '../../platform/api';
import {config} from '../../platform/config';
import {createCheckout, listGateways} from '../../platform/payments';
import {orderNumber} from './employer-notify';
import {settleListingOrder} from './employer-settle';
import type {BoardSettings} from './settings';

/**
 * What an employer buys (F12, F15 renew, F25): a listing order for one job, priced by the SERVER
 * from the chosen tier (the client sends a tier id, never a price, days or featured). Paid tiers
 * go through the platform's checkout (the catalogue price `tier.priceKey` decides the amount);
 * free posting makes a $0 order that is settled at once. Settling (here, for both) is the one
 * place a paid order moves its job: live or into review (new), or one more period (renew).
 */

/** When free posting is on and the admin has no active tier: a plain 30-day listing. */
const DEFAULT_FREE = {tierId: null, name: 'Free listing', priceKey: null, priceCents: 0, durationDays: 30, includesFeatured: false};

export {orderNumber};
export {flagForRefund, refundListingOrder, settleListingOrder} from './employer-settle';

export async function activeTiers(db: PrismaClient, settings: BoardSettings): Promise<TierOption[]> {
  const rows = await db.listingTier.findMany({
    where: {isActive: true},
    orderBy: [{sortOrder: 'asc'}, {id: 'asc'}],
    take: LIMITS.tiersActiveMax,
    select: {id: true, name: true, priceCents: true, currency: true, durationDays: true, includesFeatured: true},
  });
  return rows.map(t => ({...t, priceCents: settings.freePostingEnabled ? 0 : t.priceCents}));
}

export interface ChosenTier {
  tierId: number | null;
  name: string;
  priceKey: string | null;
  priceCents: number;
  currency: string;
  durationDays: number;
  includesFeatured: boolean;
  free: boolean;
}

/** The tier the employer picked (or the only one), as the SERVER prices it. */
export async function chooseTier(db: PrismaClient, settings: BoardSettings, tierId: number | null): Promise<{tier: ChosenTier} | {field: string} | {unavailable: string; status: 409 | 503}> {
  const rows = await db.listingTier.findMany({
    where: {isActive: true},
    orderBy: [{sortOrder: 'asc'}, {id: 'asc'}],
    take: LIMITS.tiersActiveMax,
    select: {id: true, name: true, priceKey: true, priceCents: true, currency: true, durationDays: true, includesFeatured: true},
  });
  const free = settings.freePostingEnabled;
  const row = tierId !== null ? rows.find(t => t.id === tierId) : rows.length === 1 ? rows[0] : undefined;
  if (!row) {
    if (!rows.length && free) return {tier: {...DEFAULT_FREE, currency: settings.currency, free}};
    if (!rows.length) return {unavailable: 'Posting is not open yet: the board has no listing options. Try again later.', status: 503};
    return {field: 'Choose a listing option.'};
  }
  if (!free && !row.priceKey) return {unavailable: 'This listing option has no price yet, so it cannot be bought right now. Choose another one or try again later.', status: 409};
  return {
    tier: {
      tierId: row.id,
      name: row.name,
      priceKey: row.priceKey,
      priceCents: free ? 0 : row.priceCents,
      currency: row.currency,
      durationDays: Math.min(Math.max(row.durationDays, 1), LIMITS.tierDaysMax),
      includesFeatured: row.includesFeatured,
      free,
    },
  };
}

type Problem = {status: 404 | 422 | 502 | 503; code: string; message: string};

/**
 * Creates the order for `jobId` and either settles it (free) or starts the checkout. Several ways
 * to pay and none chosen: nothing is created, the buyer chooses and the request comes again.
 */
export async function startListing(
  db: PrismaClient,
  requestUrl: string,
  input: {companyId: number; viewer: Viewer; jobId: number; kind: 'new' | 'renew'; tier: ChosenTier; gateway?: string; cancelPath: string}
): Promise<ListingAnswer | {problem: Problem}> {
  const {tier, jobId} = input;
  const orderData = {
    companyId: input.companyId,
    userId: input.viewer.id,
    jobId,
    tierId: tier.tierId,
    kind: input.kind,
    status: 'pending',
    priceKey: tier.free ? null : tier.priceKey,
    amountCents: tier.priceCents,
    currency: tier.currency,
    tierName: tier.name,
    durationDays: tier.durationDays,
    includesFeatured: tier.includesFeatured,
  };
  if (tier.free) {
    const order = await db.listingOrder.create({data: orderData, select: {id: true}});
    const settled = await settleListingOrder(db, requestUrl, {id: order.id}, {});
    const job = await db.job.findUnique({where: {id: jobId}, select: {status: true}});
    return {status: 'done', jobId, orderId: settled?.orderId ?? order.id, jobStatus: (job?.status ?? 'pending_review') as never};
  }
  // `npm run dev` on a machine without a Site Key: no payment service to call, so settle the order
  // at once to test the rest of the flow. `import.meta.env.DEV` is false in every build.
  if (import.meta.env.DEV && !config.siteKey) {
    const order = await db.listingOrder.create({data: orderData, select: {id: true}});
    const settled = await settleListingOrder(db, requestUrl, {id: order.id}, {});
    const job = await db.job.findUnique({where: {id: jobId}, select: {status: true}});
    return {status: 'done', jobId, orderId: settled?.orderId ?? order.id, jobStatus: (job?.status ?? 'pending_review') as never};
  }
  const priceKey = tier.priceKey!;
  try {
    let gateway = input.gateway;
    if (!gateway) {
      const ways = await listGateways(requestUrl, priceKey);
      if (!ways.ok) return {problem: platformProblem(ways)};
      if (ways.data.length > 1) return {status: 'choose', jobId, gateways: ways.data};
      gateway = ways.data[0]?.slug;
    }
    const order = await db.listingOrder.create({data: orderData, select: {id: true}});
    const started = await createCheckout(requestUrl, {
      price: priceKey,
      successPath: '/dashboard/employer/jobs',
      cancelPath: input.cancelPath,
      metadata: {listingOrder: String(order.id)},
      ...(gateway ? {gateway} : {}),
      email: input.viewer.email ?? undefined,
      name: input.viewer.name?.slice(0, 120) ?? undefined,
      customerRef: String(input.viewer.id),
    });
    if (!started.ok) {
      await db.listingOrder.update({where: {id: order.id}, data: {status: 'failed'}, select: {id: true}});
      return {problem: platformProblem(started)};
    }
    await db.listingOrder.update({where: {id: order.id}, data: {checkoutId: started.data.id}, select: {id: true}});
    return {status: 'checkout', jobId, orderId: order.id, checkout: {id: started.data.id, mode: started.data.mode, embedded: started.data.embedded}};
  } catch (err) {
    if (err instanceof SiteKeyMissing) return {problem: {status: 503, code: 'payments_unavailable', message: 'Payments are not set up on this site yet. Your job is saved; try again later.'}};
    throw err;
  }
}

function platformProblem(r: {status: number; code: string; message: string}): Problem {
  const code = r.code.toLowerCase();
  if (r.code === 'E_PAYMENTS_NOT_READY') return {status: 503, code, message: 'This board is not taking payments yet. Your job is saved; try again later.'};
  if (r.status === 404) return {status: 404, code, message: 'This listing option is not for sale right now.'};
  if (r.status === 422) return {status: 422, code, message: r.message};
  return {status: r.status === 0 ? 503 : 502, code, message: r.message};
}

const orderSelect = {
  id: true,
  createdAt: true,
  paidAt: true,
  refundedAt: true,
  kind: true,
  status: true,
  jobId: true,
  tierName: true,
  durationDays: true,
  includesFeatured: true,
  amountCents: true,
  currency: true,
  receiptUrl: true,
  job: {select: {title: true}},
} as const;

type OrderRow = {
  id: number;
  createdAt: Date;
  paidAt: Date | null;
  kind: string;
  status: string;
  jobId: number | null;
  tierName: string;
  durationDays: number;
  includesFeatured: boolean;
  amountCents: number;
  currency: string;
  receiptUrl: string | null;
  job: {title: string} | null;
};

export const toOrderRow = (o: OrderRow): EmployerOrderRow => ({
  id: o.id,
  number: orderNumber(o.id),
  createdAt: o.createdAt.toISOString(),
  paidAt: o.paidAt?.toISOString() ?? null,
  kind: o.kind === 'renew' ? 'renew' : 'new',
  status: o.status as EmployerOrderRow['status'],
  jobId: o.jobId,
  jobTitle: o.job?.title ?? null,
  tierName: o.tierName,
  durationDays: o.durationDays,
  includesFeatured: o.includesFeatured,
  amountCents: o.amountCents,
  currency: o.currency,
  receiptUrl: o.receiptUrl,
});

/** Billing (F18): the company's paid and refunded orders, newest first. */
export async function listOwnOrders(db: PrismaClient, companyId: number, before: number | undefined, pageSize: number) {
  const rows = await db.listingOrder.findMany({
    where: {companyId, status: {in: ['paid', 'refunded']}, ...(before ? {id: {lt: before}} : {})},
    orderBy: {id: 'desc'},
    take: pageSize + 1,
    select: orderSelect,
  });
  const items = rows.slice(0, pageSize).map(toOrderRow);
  return {items, nextBefore: rows.length > pageSize ? items.at(-1)!.id : null};
}

export async function findOwnOrder(db: PrismaClient, companyId: number, id: number) {
  if (!isDbId(id)) return null;
  return db.listingOrder.findFirst({where: {id, companyId, status: {in: ['paid', 'refunded']}}, select: {...orderSelect, userId: true}});
}
