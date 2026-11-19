import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {setCacheModeForTests} from '../../src/platform/cache';
import {Browser, configureEnv, DATABASE_URL, db, ownerSignedIn, resetDatabase} from './support/harness';

/**
 * The admin overview and activity chart are counted in the database (one aggregate query each):
 * the numbers must match the rows, in the board's currency, bucketed by UTC day.
 */
const DAY = 86_400_000;

describe.skipIf(!DATABASE_URL)('manage reports (integration, real Postgres)', () => {
  let owner: Browser;

  beforeAll(() => configureEnv());
  afterAll(async () => {
    setCacheModeForTests(null);
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    setCacheModeForTests('memory'); // an empty cache for each test
    owner = await ownerSignedIn(app, undefined, '203.0.113.9');
  });

  async function seed() {
    const now = Date.now();
    const category = await db.category.upsert({where: {slug: 'ops'}, create: {name: 'Ops', slug: 'ops'}, update: {}});
    const company = await db.company.create({data: {name: 'Acme', slug: 'acme'}});
    await db.company.create({data: {name: 'Blocked', slug: 'blocked', isBlocked: true}});
    const job = (slug: string, status: string, publishedAt: Date | null, expiresAt: Date | null) =>
      db.job.create({
        data: {companyId: company.id, categoryId: category.id, title: slug, slug, descriptionHtml: '<p>x</p>', descriptionMd: 'x', employmentType: 'FULL_TIME', workplaceType: 'remote', status, publishedAt, expiresAt},
      });
    await job('live-1', 'published', new Date(now - DAY), new Date(now + 10 * DAY));
    await job('live-2', 'published', new Date(now - 2 * DAY), new Date(now + 10 * DAY));
    await job('waiting', 'pending_review', null, null);
    await job('gone', 'expired', new Date(now - 40 * DAY), new Date(now - 10 * DAY));
    const order = (amountCents: number, status: string, paidAt: Date | null, currency = 'USD', refundedAt: Date | null = null) =>
      db.listingOrder.create({data: {companyId: company.id, status, amountCents, currency, paidAt, refundedAt, tierName: 'Standard', durationDays: 30}});
    await order(9900, 'paid', new Date(now - DAY));
    await order(4900, 'paid', new Date(now - DAY));
    await order(19900, 'paid', new Date(now - 60 * DAY));
    await order(5000, 'paid', new Date(now - DAY), 'EUR'); // another currency: not counted
    await order(9900, 'refunded', new Date(now - 3 * DAY), 'USD', new Date(now - 2 * DAY));
    await order(9900, 'pending', null);
  }

  it('overview numbers are exact and in the board currency', async () => {
    await seed();
    const res = await owner.get('/site-api/manage/overview');
    expect(res.status).toBe(200);
    const o = res.json as Record<string, {value: number; more: boolean}> & {currency: string; topJobs: {title: string}[]};
    expect(o.currency).toBe('USD');
    expect(o.revenueAll).toEqual({value: 9900 + 4900 + 19900, more: false});
    expect(o.revenue30d).toEqual({value: 9900 + 4900, more: false});
    expect(o.paidOrders.value).toBe(3);
    expect(o.pendingApprovals.value).toBe(1);
    expect(o.activeJobs.value).toBe(2);
    expect(o.companies.value).toBe(1);
    expect(o.topJobs.map(j => j.title).sort()).toEqual(['live-1', 'live-2']);
  });

  it("the overview's 30 days are the chart's 30 UTC days, so the card and the chart agree", async () => {
    await seed();
    const job = await db.job.findFirstOrThrow({where: {slug: 'live-1'}});
    const today = new Date();
    const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const apply = (at: number, email: string) =>
      db.application.create({data: {jobId: job.id, name: 'A', email, consentAt: new Date(at), consentText: 'ok', createdAt: new Date(at)}});
    await apply(Date.now() - 60_000, 'now@example.com');
    await apply(startOfToday - 29 * DAY + 60_000, 'first-day@example.com'); // the chart's oldest day
    await apply(startOfToday - 29 * DAY - 60_000, 'before@example.com'); // under 30×24 h ago, but before that day
    const o = (await owner.get('/site-api/manage/overview')).json as {applications30d: {value: number}};
    const a = (await owner.get('/site-api/manage/overview/activity?range=30d')).json as {rows: {applications: number}[]};
    expect(o.applications30d.value).toBe(2);
    expect(a.rows.reduce((n, r) => n + r.applications, 0)).toBe(o.applications30d.value);
  });

  it('activity buckets by UTC day, newest first', async () => {
    await seed();
    const res = await owner.get('/site-api/manage/overview/activity?range=7d');
    expect(res.status).toBe(200);
    const a = res.json as {granularity: string; rows: {period: string; revenueCents: number; paidOrders: number; refunds: number; jobsPublished: number}[]};
    expect(a.granularity).toBe('day');
    expect(a.rows).toHaveLength(7);
    const dayOf = (offset: number) => {
      const d = new Date(Date.now() - offset * DAY);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    };
    const row = (offset: number) => a.rows.find(r => r.period === dayOf(offset))!;
    expect(a.rows[0]!.period).toBe(dayOf(0));
    expect(row(1)).toMatchObject({revenueCents: 9900 + 4900, paidOrders: 2, jobsPublished: 1});
    expect(row(2)).toMatchObject({refunds: 1, jobsPublished: 1});
    const monthly = await owner.get('/site-api/manage/overview/activity?range=12m');
    const m = monthly.json as {granularity: string; rows: {paidOrders: number}[]};
    expect(m.granularity).toBe('month');
    expect(m.rows.reduce((n, r) => n + r.paidOrders, 0)).toBe(3);
  });
});
