import {createHmac} from 'node:crypto';

import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {EMPTY_JOB_VALUES} from '../../src/lib/job-input';
import {getDb} from '../../src/platform/db';
import {handlePaymentDelivery} from '../../src/platform/payments';
import {inRequestScope} from '../../src/platform/request-scope';
import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {paymentHooks} from '../../src/server/payments-hooks';
import {env} from './support/cloudflare-workers';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * The PAID listing path end to end: the admin's priced tier (catalogue), the employer's post
 * (server-priced checkout), the platform's SIGNED payment event (`/site-api/_platform/payments`,
 * as `src/pages/site-api/[...path].ts` mounts it) and the thanks page's confirm
 * (`GET /site-api/checkout/:id`), replays, refunds and renewals. The platform is faked.
 */

const SECRET = 'jobs-secret-for-integration-0123456789abcdef';
const DAY = 86_400_000;
const PRICES = {'listing-30': 9900, 'listing-60': 14900} as Record<string, number>;
const started: Array<Record<string, unknown>> = [];
/** What the fake platform answers for GET /payments/checkout/:id. */
const checkouts = new Map<string, Record<string, unknown>>();
let seq = 0;
let eventSeq = 0;
const previousFetch = globalThis.fetch;

function fakePlatform() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.includes('/api/site/v1/payments') ? url.slice(url.indexOf('/api/site/v1/payments') + 21).split('?')[0] : null;
    if (path === '') {
      const price = (key: string) => ({key, name: key, description: null, amountCents: PRICES[key], currency: 'USD', interval: 'one_time', intervalCount: 1, trialDays: 0});
      return Response.json({data: {mode: 'test', ready: true, prices: Object.keys(PRICES).map(price)}});
    }
    if (path === '/checkout/gateways') return Response.json({data: {gateways: [{slug: 'stripe', name: 'Card'}]}});
    if (path === '/checkout' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      started.push(body);
      const id = `pcs_board${String(++seq).padStart(8, '0')}`;
      checkouts.set(id, {...checkout(id, String(body.price)), status: 'open', paidAt: null, metadata: body.metadata ?? {}, customerRef: body.customerRef ?? null});
      return Response.json({data: {id, mode: 'test', embedded: {kind: 'window', gateway: 'stripe', checkoutUrl: 'https://pay.example/x', returnUrl: '/'}}});
    }
    if (path?.startsWith('/checkout/')) {
      const found = checkouts.get(decodeURIComponent(path.slice('/checkout/'.length)));
      return found ? Response.json({data: found}) : Response.json({errors: [{code: 'E_NOT_FOUND'}]}, {status: 404});
    }
    return previousFetch(input, init);
  };
}

const checkout = (id: string, price = 'listing-30', over: Record<string, unknown> = {}) => ({
  id, mode: 'test', status: 'paid', price, quantity: 1, email: 'emp@example.test', amountCents: PRICES[price] ?? 100, currency: 'USD',
  paidAt: new Date().toISOString(), subscription: null, metadata: {}, customerRef: null, ...over,
});

/** The platform marks the checkout paid (so a confirm sees it) and returns its paid copy. */
function pay(id: string) {
  const paid = {...checkouts.get(id)!, status: 'paid', paidAt: new Date().toISOString()};
  checkouts.set(id, paid);
  return paid;
}

/** A signed delivery, run like the Worker would (request scope, Site Database). */
async function deliver(type: string, data: unknown, id = `pev_board${++eventSeq}`) {
  const text = JSON.stringify({id, type, mode: 'test', createdAt: new Date().toISOString(), data});
  const at = Math.floor(Date.now() / 1000);
  const mac = createHmac('sha256', SECRET).update(`${at}.${text}`).digest('hex');
  const request = new Request(`https://shop.example.test/site-api/_platform/payments`, {
    method: 'POST', headers: {'content-type': 'application/json', 'x-site-signature': `t=${at},v1=${mac}`}, body: text,
  });
  return inRequestScope(async () => {
    const res = await handlePaymentDelivery(request, paymentHooks);
    await getDb()?.$disconnect();
    return {status: res.status, json: (await res.json()) as Record<string, unknown>, id};
  });
}

const description = 'We are hiring a careful engineer to build and run our services. '.repeat(5);
let categoryId = 0;
const jobValues = (over: Record<string, string> = {}) => ({...EMPTY_JOB_VALUES, title: 'Backend Engineer', categoryId: String(categoryId), descriptionMd: description, tags: 'go', ...over});
const company = (name = 'Acme Robots') => ({companyName: name, website: 'https://acme.example', location: 'Berlin', about: 'We build robots.'});
const logs = (templateKey: string) => db.emailLog.count({where: {templateKey}});
const jobOf = (id: number) =>
  db.job.findUniqueOrThrow({where: {id}, select: {status: true, expiresAt: true, durationDays: true, tierId: true, expiryReminderSentAt: true, needsReview: true, source: true}});

describe.skipIf(!DATABASE_URL)('board payments: the paid listing path (integration, real Postgres)', () => {
  let owner: Browser;
  let emp: Browser;
  let standard = 0;
  let long = 0;

  async function moderation(mode: 'all' | 'auto') {
    expect((await owner.request('PUT', '/site-api/manage/settings/moderation', {mode})).status).toBe(200);
    forgetBoardSettings();
  }
  /** Employer posts on the Standard tier, with fields the server must ignore. */
  async function postPaid(browser = emp, over: Record<string, unknown> = {}) {
    const res = await browser.post('/site-api/employer/post', {
      job: jobValues(), company: company(), tierId: standard,
      price: 1, amountCents: 1, priceKey: 'listing-cheap', durationDays: 365, includesFeatured: true, featured: true, metadata: {listingOrder: '999'}, ...over,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.status).toBe('checkout');
    return {jobId: res.json.jobId as number, orderId: res.json.orderId as number, checkoutId: (res.json.checkout as {id: string}).id};
  }

  beforeAll(() => {
    configureEnv();
    (env as Record<string, string>).SITE_JOBS_SECRET = SECRET;
    fakePlatform();
  });
  afterAll(async () => {
    globalThis.fetch = previousFetch;
    delete (env as Record<string, string | undefined>).SITE_JOBS_SECRET;
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    forgetBoardSettings();
    started.length = 0;
    checkouts.clear();
    categoryId = (await db.category.upsert({where: {slug: 'engineering'}, create: {name: 'Engineering', slug: 'engineering'}, update: {isActive: true}, select: {id: true}})).id;
    owner = await signedIn(app, 'owner@example.test', undefined, '203.0.113.31');
    // (1) The admin's paid tiers, priced from the catalogue; free posting stays off.
    const tier = (name: string, priceKey: string, durationDays: number) => owner.post('/site-api/manage/tiers', {name, priceKey, durationDays, isActive: true});
    const a = await tier('Standard', 'listing-30', 30);
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    standard = (a.json.tier as {id: number}).id;
    long = ((await tier('Long', 'listing-60', 60)).json.tier as {id: number}).id;
    const tiers = await owner.get('/site-api/manage/tiers');
    expect(tiers.json).toMatchObject({freePostingEnabled: false, tiers: [{id: standard, priceCents: 9900, priceKey: 'listing-30'}, {id: long, priceCents: 14900}]});
    emp = await signedIn(app, 'emp@example.test', undefined, '203.0.113.32');
  });

  it("(2-4) moderation 'all': server-priced checkout, event + confirm + replay settle once, into review", async () => {
    const {jobId, orderId, checkoutId} = await postPaid();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({price: 'listing-30', quantity: 1, customerRef: String(await userId('emp@example.test')), metadata: {listingOrder: String(orderId)}});
    for (const key of ['amountCents', 'durationDays', 'includesFeatured', 'featured']) expect(started[0]).not.toHaveProperty(key);
    expect(await db.listingOrder.findUniqueOrThrow({where: {id: orderId}, select: {status: true, checkoutId: true, amountCents: true, durationDays: true, includesFeatured: true, priceKey: true}}))
      .toEqual({status: 'pending', checkoutId, amountCents: 9900, durationDays: 30, includesFeatured: false, priceKey: 'listing-30'});
    expect((await jobOf(jobId)).status).toBe('pending_payment');

    const paid = pay(checkoutId);
    const first = await deliver('checkout.paid', paid);
    expect(first.status).toBe(200);
    const confirm = await emp.get(`/site-api/checkout/${checkoutId}`);
    expect(confirm.status).toBe(200);
    expect(confirm.json.checkout).toMatchObject({id: checkoutId, status: 'paid'});
    expect(confirm.json.checkout).not.toHaveProperty('metadata');
    expect((await deliver('checkout.paid', paid, first.id)).json).toMatchObject({duplicate: true});
    // A second delivery of the same payment under a new event id: still once.
    expect((await deliver('checkout.paid', paid)).status).toBe(200);

    expect(await db.listingOrder.count({where: {status: 'paid'}})).toBe(1);
    expect(await db.order.count()).toBe(1);
    const job = await jobOf(jobId);
    expect(job).toMatchObject({status: 'pending_review', needsReview: true, durationDays: 30, source: 'paid'});
    expect(await logs('order-receipt')).toBe(1);
    expect(await logs('job-submitted')).toBe(1);
    expect(await logs('job-approved')).toBe(0);
  });

  it("(4) moderation 'auto': the confirm alone publishes for the tier's days; the later event adds nothing", async () => {
    await moderation('auto');
    const before = Date.now();
    const {jobId, checkoutId} = await postPaid();
    pay(checkoutId);
    expect((await emp.get(`/site-api/checkout/${checkoutId}`)).status).toBe(200);
    const job = await jobOf(jobId);
    expect(job.status).toBe('published');
    expect(job.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(job.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);
    expect((await deliver('checkout.paid', checkouts.get(checkoutId))).status).toBe(200);
    expect((await jobOf(jobId)).expiresAt).toEqual(job.expiresAt);
    expect(await logs('order-receipt')).toBe(1);
    expect(await logs('job-approved')).toBe(1);
  });

  it("(5) a paid checkout matching no listing order changes nothing, whatever its metadata says", async () => {
    await moderation('auto');
    const mine = await postPaid();
    const other = await signedIn(app, 'other@example.test', undefined, '203.0.113.33');
    // A plain Buy-button checkout whose browser metadata names the employer's order and job.
    const forged = await other.post('/site-api/checkout', {price: 'listing-30', metadata: {listingOrder: String(mine.orderId), jobId: String(mine.jobId)}});
    expect(forged.status, JSON.stringify(forged.json)).toBe(200);
    const forgedId = forged.json.id as string;
    expect((await deliver('checkout.paid', pay(forgedId))).status).toBe(200);
    expect((await other.get(`/site-api/checkout/${forgedId}`)).status).toBe(200);
    // And an id the platform never issued to this site.
    expect((await deliver('checkout.paid', checkout('pcs_nobody000000001', 'listing-30', {metadata: {listingOrder: String(mine.orderId)}}))).status).toBe(200);

    expect(await db.listingOrder.findUniqueOrThrow({where: {id: mine.orderId}, select: {status: true}})).toEqual({status: 'pending'});
    expect((await jobOf(mine.jobId)).status).toBe('pending_payment');
    expect(await db.listingOrder.count({where: {status: 'paid'}})).toBe(0);
    expect(await logs('order-receipt')).toBe(0);
  });

  it('(6) a full refund takes the listing down and marks the order refunded', async () => {
    const review = await postPaid();
    await deliver('checkout.paid', pay(review.checkoutId));
    await moderation('auto');
    const live = await postPaid(emp, {job: jobValues({title: 'Frontend Engineer'})});
    await deliver('checkout.paid', pay(live.checkoutId));
    expect((await jobOf(review.jobId)).status).toBe('pending_review');
    expect((await jobOf(live.jobId)).status).toBe('published');

    const refund = (checkoutId: string) => ({checkoutId, amountCents: 9900, currency: 'USD', full: true, refundedAt: new Date().toISOString()});
    expect((await deliver('payment.refunded', refund(review.checkoutId))).status).toBe(200);
    expect((await deliver('payment.refunded', refund(live.checkoutId))).status).toBe(200);
    expect((await jobOf(review.jobId)).status).toBe('rejected');
    expect((await jobOf(live.jobId)).status).toBe('closed');
    expect(await db.listingOrder.count({where: {status: 'refunded', refundedAt: {not: null}}})).toBe(2);
    expect(await db.order.count({where: {status: 'refunded'}})).toBe(2);
  });

  it("(7) renewing a live job: a new paid checkout adds the new tier's days to the days left, reminder reset", async () => {
    await moderation('auto');
    const {jobId, checkoutId} = await postPaid();
    await deliver('checkout.paid', pay(checkoutId));
    const leftUntil = new Date(Date.now() + 5 * DAY);
    await db.job.update({where: {id: jobId}, data: {expiresAt: leftUntil, expiryReminderSentAt: new Date()}});
    const renew = await emp.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId: long, durationDays: 365, price: 1});
    expect(renew.status, JSON.stringify(renew.json)).toBe(200);
    expect(renew.json.status).toBe('checkout');
    const renewId = (renew.json.checkout as {id: string}).id;
    expect(started.at(-1)).toMatchObject({price: 'listing-60'});
    // Unpaid, nothing moves.
    expect((await jobOf(jobId)).expiryReminderSentAt).not.toBeNull();

    const before = Date.now();
    expect((await deliver('checkout.paid', pay(renewId))).status).toBe(200);
    const job = await jobOf(jobId);
    expect(job).toMatchObject({status: 'published', durationDays: 60, tierId: long, expiryReminderSentAt: null});
    // The 5 days left are kept: the new 60 days start where they end.
    expect(job.expiresAt!.getTime()).toBe(leftUntil.getTime() + 60 * DAY);
    expect((await emp.get(`/site-api/checkout/${renewId}`)).status).toBe(200);
    expect((await jobOf(jobId)).expiresAt).toEqual(job.expiresAt);
    expect(await db.listingOrder.count({where: {kind: 'renew', status: 'paid'}})).toBe(1);
    expect(await logs('order-receipt')).toBe(2);
  });

  it('(8) a job edited since its approval (needsReview) is renewed into review, not live', async () => {
    await moderation('auto');
    const {jobId, checkoutId} = await postPaid();
    await deliver('checkout.paid', pay(checkoutId));
    await db.job.update({where: {id: jobId}, data: {status: 'expired', expiresAt: new Date(Date.now() - DAY)}});
    await moderation('all');
    const put = await emp.request('PUT', `/site-api/employer/jobs/${jobId}`, {job: jobValues({title: 'Totally different role'})});
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(await jobOf(jobId)).toMatchObject({status: 'expired', needsReview: true});

    const renew = await emp.post(`/site-api/employer/jobs/${jobId}/renew`, {tierId: standard});
    expect(renew.json.status).toBe('checkout');
    const renewId = (renew.json.checkout as {id: string}).id;
    await deliver('checkout.paid', pay(renewId));
    await emp.get(`/site-api/checkout/${renewId}`);
    const job = await jobOf(jobId);
    expect(job).toMatchObject({status: 'pending_review', needsReview: true});
    expect(job.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(await logs('job-submitted')).toBe(1);
    expect(await db.listingOrder.count({where: {kind: 'renew', status: 'paid'}})).toBe(1);
  });
});
