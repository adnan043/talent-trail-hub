import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {EMPTY_JOB_VALUES} from '../../src/lib/job-input';
import type {Checkout, PaymentEventInfo} from '../../src/platform/payments';
import {getDb} from '../../src/platform/db';
import {inRequestScope} from '../../src/platform/request-scope';
import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {paymentHooks} from '../../src/server/payments-hooks';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn} from './support/harness';

/**
 * The employer area (workstream C) against a real Postgres: own company only, the server prices
 * the tier, the paid hook settles once, free posting, single-company mode. The platform's
 * payment API is faked here (no Site Key on a dev machine).
 */

const PRICE = 'listing-standard-30';
const started: Record<string, unknown>[] = [];
let checkoutSeq = 0;
const previousFetch = globalThis.fetch;

function fakePayments() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/site/v1/payments/checkout/gateways')) {
      return Response.json({data: {gateways: [{slug: 'stripe', name: 'Card'}]}});
    }
    if (url.endsWith('/api/site/v1/payments/checkout') && init?.method === 'POST') {
      started.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const id = `pcs_test${String(++checkoutSeq).padStart(8, '0')}`;
      return Response.json({
        data: {id, mode: 'test', embedded: {kind: 'window', gateway: 'stripe', checkoutUrl: 'https://pay.example/x', returnUrl: '/dashboard/employer/jobs'}},
      });
    }
    return previousFetch(input, init);
  };
}

const description = 'We are hiring a careful engineer to build and run our services. '.repeat(5);
const jobValues = (over: Record<string, string> = {}) => ({...EMPTY_JOB_VALUES, title: 'Backend Engineer', categoryId: String(categoryId), descriptionMd: description, tags: 'go, postgres', ...over});
const company = {companyName: 'Acme Robots', website: 'https://acme.example', location: 'Berlin', about: 'We build **robots**.'};

let categoryId = 0;
let tierId = 0;

const paidCheckout = (id: string, over: Partial<Checkout> = {}): Checkout =>
  ({id, mode: 'test', status: 'paid', price: PRICE, quantity: 1, email: 'a@example.test', amountCents: 9900, currency: 'USD', paidAt: new Date().toISOString(), subscription: null, ...over}) as Checkout;
const eventInfo: PaymentEventInfo = {id: 'pev_1', type: 'checkout.paid', mode: 'test', createdAt: new Date().toISOString(), source: 'event'} as PaymentEventInfo;

/** Runs a hook as the platform's delivery would: in a request scope, with the Site Database. */
const runHook = (fn: () => unknown) =>
  inRequestScope(async () => {
    await fn();
    await getDb()?.$disconnect();
  });

async function post(browser: Browser, body: Record<string, unknown> = {}) {
  return browser.post('/site-api/employer/post', {job: jobValues(), company, tierId, ...body});
}

describe.skipIf(!DATABASE_URL)('employer area (integration, real Postgres)', () => {
  let a: Browser;
  let b: Browser;

  beforeAll(() => {
    configureEnv();
    fakePayments();
  });
  afterAll(async () => {
    globalThis.fetch = previousFetch;
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    forgetBoardSettings();
    started.length = 0;
    const category = await db.category.upsert({where: {slug: 'engineering'}, create: {name: 'Engineering', slug: 'engineering'}, update: {isActive: true}, select: {id: true}});
    categoryId = category.id;
    tierId = (await db.listingTier.create({data: {name: 'Standard', priceKey: PRICE, priceCents: 9900, durationDays: 30}, select: {id: true}})).id;
    a = await signedIn(app, 'a@example.test', undefined, '203.0.113.21');
    b = await signedIn(app, 'b@example.test', undefined, '203.0.113.22');
  });

  it('the server prices the tier: the client cannot send a price, days or featured', async () => {
    const res = await post(a, {price: 1, amountCents: 1, durationDays: 365, includesFeatured: true, featured: true, priceKey: 'cheap'});
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('checkout');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({price: PRICE, quantity: 1, customerRef: expect.any(String)});
    expect(started[0]).not.toHaveProperty('amountCents');
    const order = await db.listingOrder.findFirstOrThrow({select: {amountCents: true, durationDays: true, includesFeatured: true, status: true, priceKey: true, checkoutId: true}});
    expect(order).toMatchObject({amountCents: 9900, durationDays: 30, includesFeatured: false, status: 'pending', priceKey: PRICE});
    const job = await db.job.findFirstOrThrow({select: {status: true, durationDays: true, listingFeatured: true, isFeatured: true}});
    expect(job).toEqual({status: 'pending_payment', durationDays: 30, listingFeatured: false, isFeatured: false});
    // An unknown tier is a field error, not a default.
    expect((await post(a, {tierId: tierId + 99})).status).toBe(422);
  });

  it('the paid hook finds the order by checkout id and settles it exactly once', async () => {
    const res = await post(a);
    const checkoutId = (res.json.checkout as {id: string}).id;
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(checkoutId), eventInfo));
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(checkoutId), eventInfo));
    const order = await db.listingOrder.findFirstOrThrow({select: {status: true, paidAt: true}});
    expect(order.status).toBe('paid');
    // Moderation "all" (the default): into review, once.
    expect((await db.job.findFirstOrThrow({select: {status: true}})).status).toBe('pending_review');
    const receipts = await db.emailLog.count({where: {templateKey: 'order-receipt'}});
    expect(receipts).toBe(1);
    expect(await db.order.count()).toBe(1);
    // Another checkout (metadata naming our order) changes nothing: only the checkout id counts.
    await runHook(() => paymentHooks.onCheckoutPaid!({...paidCheckout('pcs_other00000001'), metadata: {listingOrder: '1'}} as Checkout, eventInfo));
    expect(await db.listingOrder.count({where: {status: 'paid'}})).toBe(1);
  });

  it('a paid order for another price is not settled', async () => {
    const res = await post(a);
    const checkoutId = (res.json.checkout as {id: string}).id;
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(checkoutId, {price: 'something-cheap'}), eventInfo));
    expect((await db.listingOrder.findFirstOrThrow({select: {status: true}})).status).toBe('pending');
    expect((await db.job.findFirstOrThrow({select: {status: true}})).status).toBe('pending_payment');
  });

  it('free posting: a $0 order, no checkout, the job goes live in auto mode', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true, moderationMode: 'auto'}, update: {freePostingEnabled: true, moderationMode: 'auto'}});
    forgetBoardSettings();
    const res = await post(a);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({status: 'done', jobStatus: 'published'});
    expect(started).toHaveLength(0);
    const order = await db.listingOrder.findFirstOrThrow({select: {amountCents: true, status: true, checkoutId: true}});
    expect(order).toEqual({amountCents: 0, status: 'paid', checkoutId: null});
    const job = await db.job.findFirstOrThrow({select: {source: true, expiresAt: true}});
    expect(job.source).toBe('free');
    expect(job.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("an employer cannot see or change another company's jobs or orders (404)", async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true}, update: {freePostingEnabled: true}});
    forgetBoardSettings();
    const res = await post(a);
    const jobId = res.json.jobId as number;
    const orderId = res.json.orderId as number;
    await post(b, {company: {...company, companyName: 'Beta Labs'}});

    expect((await a.get(`/site-api/employer/jobs/${jobId}`)).status).toBe(200);
    expect((await b.get(`/site-api/employer/jobs/${jobId}`)).status).toBe(404);
    expect((await b.request('PUT', `/site-api/employer/jobs/${jobId}`, {job: jobValues({title: 'Hijacked'})})).status).toBe(404);
    expect((await b.post(`/site-api/employer/jobs/${jobId}/close`)).status).toBe(404);
    expect((await b.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId})).status).toBe(404);
    expect((await b.get(`/site-api/employer/orders/${orderId}`)).status).toBe(404);
    expect((await a.get(`/site-api/employer/orders/${orderId}`)).status).toBe(200);
    // Re-posting with someone else's job id never touches that job.
    await post(b, {jobId});
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {title: true, status: true}})).title).toBe('Backend Engineer');

    const listA = (await a.get('/site-api/employer/jobs')).json.items as {id: number}[];
    const listB = (await b.get('/site-api/employer/jobs')).json.items as {id: number}[];
    expect(listA.map(j => j.id)).toEqual([jobId]);
    expect(listB.map(j => j.id)).not.toContain(jobId);
    const ordersB = (await b.get('/site-api/employer/orders')).json.items as {id: number}[];
    expect(ordersB.map(o => o.id)).not.toContain(orderId);
    expect((await new Browser(app).get('/site-api/employer/jobs')).status).toBe(401);
  });

  it('editing a live job sends it back to review when every post is reviewed', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true, moderationMode: 'auto'}, update: {freePostingEnabled: true, moderationMode: 'auto'}});
    forgetBoardSettings();
    const jobId = (await post(a)).json.jobId as number;
    const before = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {expiresAt: true}});
    await db.boardSettings.update({where: {id: 1}, data: {moderationMode: 'all'}});
    forgetBoardSettings();
    const res = await a.request('PUT', `/site-api/employer/jobs/${jobId}`, {job: jobValues({title: 'Senior Backend Engineer'})});
    expect(res.status).toBe(200);
    expect(res.json.reReview).toBe(true);
    const after = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true, title: true, expiresAt: true}});
    expect(after).toMatchObject({status: 'pending_review', title: 'Senior Backend Engineer'});
    expect(after.expiresAt).toEqual(before.expiresAt);
  });

  it('a full refund marks the order refunded and takes the listing down', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, moderationMode: 'auto'}, update: {moderationMode: 'auto'}});
    forgetBoardSettings();
    const res = await post(a);
    const checkoutId = (res.json.checkout as {id: string}).id;
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(checkoutId), eventInfo));
    expect((await db.job.findFirstOrThrow({select: {status: true}})).status).toBe('published');
    const refund = {checkoutId, amountCents: 9900, currency: 'USD', full: true, refundedAt: new Date().toISOString()};
    await runHook(() => paymentHooks.onRefund!(refund, {...eventInfo, type: 'payment.refunded'} as PaymentEventInfo));
    expect((await db.listingOrder.findFirstOrThrow({select: {status: true}})).status).toBe('refunded');
    expect((await db.job.findFirstOrThrow({select: {status: true}})).status).toBe('closed');
  });

  it('a paid post on a tier without a price key is refused with 409', async () => {
    await db.listingTier.update({where: {id: tierId}, data: {priceKey: null}});
    const res = await post(a);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('tier_not_priced');
    expect(started).toHaveLength(0);
    expect(await db.listingOrder.count()).toBe(0);
  });

  it('renew (free posting): one more period from now with the tier bought, reminder reset', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true, moderationMode: 'auto'}, update: {freePostingEnabled: true, moderationMode: 'auto'}});
    forgetBoardSettings();
    const jobId = (await post(a)).json.jobId as number;
    await db.job.update({where: {id: jobId}, data: {status: 'expired', expiresAt: new Date(Date.now() - 86_400_000), expiryReminderSentAt: new Date()}});
    const res = await a.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId, durationDays: 365});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({status: 'done', jobStatus: 'published'});
    const job = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true, expiresAt: true, expiryReminderSentAt: true}});
    expect(job.status).toBe('published');
    expect(job.expiryReminderSentAt).toBeNull();
    const days = (job.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(await db.listingOrder.count({where: {kind: 'renew', status: 'paid'}})).toBe(1);
  });

  it('an edit made while a job is down is reviewed when it is renewed; an unedited expired one goes live', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true, moderationMode: 'auto'}, update: {freePostingEnabled: true, moderationMode: 'auto'}});
    forgetBoardSettings();
    const edited = (await post(a)).json.jobId as number;
    const plain = (await post(a, {job: jobValues({title: 'Frontend Engineer'})})).json.jobId as number;
    await db.boardSettings.update({where: {id: 1}, data: {moderationMode: 'all'}});
    forgetBoardSettings();
    expect((await a.post(`/site-api/employer/jobs/${edited}/close`)).status).toBe(200);
    // The unedited one simply ran out (a closed one is always re-checked, as a new post).
    await db.job.update({where: {id: plain}, data: {status: 'expired', expiresAt: new Date(Date.now() - 1000)}});
    const put = await a.request('PUT', `/site-api/employer/jobs/${edited}`, {job: jobValues({title: 'Totally different role'})});
    expect(put.status).toBe(200);
    expect((await db.job.findUniqueOrThrow({where: {id: edited}, select: {status: true, needsReview: true}}))).toEqual({status: 'closed', needsReview: true});

    expect((await a.post(`/site-api/employer/jobs/${edited}/renew`, {tierId})).json).toMatchObject({status: 'done', jobStatus: 'pending_review'});
    expect((await a.post(`/site-api/employer/jobs/${plain}/renew`, {tierId})).json).toMatchObject({status: 'done', jobStatus: 'published'});
    const reviewed = await db.job.findUniqueOrThrow({where: {id: edited}, select: {status: true, expiresAt: true}});
    expect(reviewed.status).toBe('pending_review');
    expect(reviewed.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('a renewal paid for a rejected job leaves it rejected and flags the order for a refund', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, moderationMode: 'auto'}, update: {moderationMode: 'auto'}});
    forgetBoardSettings();
    const first = await post(a);
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout((first.json.checkout as {id: string}).id), eventInfo));
    const jobId = first.json.jobId as number;
    const renew = await a.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId});
    expect(renew.json.status).toBe('checkout');
    // Rejected between the checkout and the payment.
    await db.job.update({where: {id: jobId}, data: {status: 'rejected', rejectionReason: 'Spam'}});
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout((renew.json.checkout as {id: string}).id), eventInfo));
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true}})).status).toBe('rejected');
    expect(await db.auditEvent.count({where: {action: 'listing_order.refund_needed'}})).toBe(1);
  });

  it('posting again supersedes the earlier checkout: paying it never moves the job', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, moderationMode: 'auto'}, update: {moderationMode: 'auto'}});
    forgetBoardSettings();
    const first = await post(a);
    const jobId = first.json.jobId as number;
    const second = await post(a, {jobId});
    expect(second.json.jobId).toBe(jobId);
    const old = (first.json.checkout as {id: string}).id;
    expect((await db.listingOrder.findUniqueOrThrow({where: {checkoutId: old}, select: {status: true}})).status).toBe('failed');
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(old), eventInfo));
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true}})).status).toBe('pending_payment');
    expect(await db.auditEvent.count({where: {action: 'listing_order.refund_needed'}})).toBe(1);
    // A retried event (or a reloaded thanks page) flags it once, never twice.
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(old), eventInfo));
    expect(await db.auditEvent.count({where: {action: 'listing_order.refund_needed'}})).toBe(1);
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout((second.json.checkout as {id: string}).id), eventInfo));
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true}})).status).toBe('published');
  });

  it('a refund is applied once, order and job together', async () => {
    const res = await post(a);
    const checkoutId = (res.json.checkout as {id: string}).id;
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(checkoutId), eventInfo));
    const refund = {checkoutId, amountCents: 9900, currency: 'USD', full: true, refundedAt: new Date().toISOString()};
    const info = {...eventInfo, type: 'payment.refunded'} as PaymentEventInfo;
    await runHook(() => paymentHooks.onRefund!(refund, info));
    await runHook(() => paymentHooks.onRefund!(refund, info));
    expect(await db.listingOrder.findFirstOrThrow({select: {status: true}})).toEqual({status: 'refunded'});
    expect(await db.job.findFirstOrThrow({select: {status: true, rejectionReason: true}})).toEqual({status: 'rejected', rejectionReason: 'Payment refunded'});
  });

  it('a job closed while in review was never approved: it cannot be renewed onto the board', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true}, update: {freePostingEnabled: true}});
    forgetBoardSettings();
    const res = await post(a);
    expect(res.json).toMatchObject({status: 'done', jobStatus: 'pending_review'});
    const jobId = res.json.jobId as number;
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {needsReview: true}})).needsReview).toBe(true);
    expect((await a.post(`/site-api/employer/jobs/${jobId}/close`)).status).toBe(200);
    const renew = await a.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId});
    expect(renew.status).toBe(409);
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true}})).status).toBe('closed');
  });

  it('renewing a live job adds the days to what is left; only the newest renewal checkout counts', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, moderationMode: 'auto'}, update: {moderationMode: 'auto'}});
    forgetBoardSettings();
    const first = await post(a);
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout((first.json.checkout as {id: string}).id), eventInfo));
    const jobId = first.json.jobId as number;
    const before = (await db.job.findUniqueOrThrow({where: {id: jobId}, select: {expiresAt: true}})).expiresAt!;
    const r1 = await a.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId});
    const r2 = await a.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId});
    const c1 = (r1.json.checkout as {id: string}).id;
    const c2 = (r2.json.checkout as {id: string}).id;
    expect((await db.listingOrder.findUniqueOrThrow({where: {checkoutId: c1}, select: {status: true}})).status).toBe('failed');
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(c2), eventInfo));
    await runHook(() => paymentHooks.onCheckoutPaid!(paidCheckout(c1), eventInfo));
    const after = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true, expiresAt: true}});
    expect(after.status).toBe('published');
    expect(after.expiresAt!.getTime() - before.getTime()).toBe(30 * 86_400_000);
    expect(await db.auditEvent.count({where: {action: 'listing_order.refund_needed'}})).toBe(1);
  });

  it('single-company mode: the whole employer API is 404', async () => {
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, freePostingEnabled: true}, update: {freePostingEnabled: true}});
    forgetBoardSettings();
    await post(a);
    const own = await db.company.findFirstOrThrow({select: {id: true}});
    await db.boardSettings.update({where: {id: 1}, data: {boardMode: 'single_company', ownerCompanyId: own.id}});
    forgetBoardSettings();
    for (const path of ['/site-api/employer/options', '/site-api/employer/jobs', '/site-api/employer/orders', '/site-api/employer/company']) {
      expect((await a.get(path)).status).toBe(404);
    }
    expect((await post(a)).status).toBe(404);
  });
});
