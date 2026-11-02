import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Bounded, ManageActivity, ManageOverview} from '../../lib/types-manage';
import {requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {DAY_MS} from './manage-shared';
import {cachedBoardSettings} from './brand';

/**
 * F19 overview numbers. Cheap and bounded (docs/agent/performance.md): every number is a capped,
 * indexed read summed here, shown "1000+" when it hit the cap; never a count over a whole table.
 */
const CAP = 1000;
const TOP_JOBS = 5;

const bounded = (rows: unknown[], cap = CAP): Bounded => ({value: Math.min(rows.length, cap), more: rows.length > cap});

const RANGES = {'7d': 7, '30d': 30, '90d': 90, '12m': 12} as const;
type Range = keyof typeof RANGES;
const ROWS_CAP = 5000;

const rangeQuery = validator('query', v => ({
  range: (typeof v.range === 'string' && v.range in RANGES ? v.range : '30d') as Range,
}));

/** Start of the UTC day (or month) the instant falls in, as the bucket's key. */
const bucketKey = (date: Date, monthly: boolean) =>
  monthly ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export const manageOverviewRoutes = new Hono()
  .get(
  '/',
  withViewer,
  requireAuth,
  requirePermission(PERMISSIONS.BOARD_REPORTS),
  withDb,
  async c => {
    const db = c.var.db;
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const settings = await cachedBoardSettings(db);
    const paid = {status: 'paid', currency: settings.currency} as const;
    const [paidAll, pending, active, applications, top, companies] = await Promise.all([
      // Newest paid orders first (index status, paid_at): the 30-day sum is a prefix of it.
      db.listingOrder.findMany({where: paid, select: {amountCents: true, paidAt: true}, orderBy: {paidAt: 'desc'}, take: CAP + 1}),
      db.job.findMany({where: {status: 'pending_review'}, select: {id: true}, take: 101}),
      db.job.findMany({where: {status: 'published', expiresAt: {gt: now}}, select: {id: true}, take: CAP + 1}),
      db.application.findMany({where: {createdAt: {gte: since}}, select: {id: true}, orderBy: {createdAt: 'desc'}, take: CAP + 1}),
      db.job.findMany({
        where: {status: 'published', expiresAt: {gt: now}},
        orderBy: [{viewCount: 'desc'}, {id: 'desc'}],
        take: TOP_JOBS,
        select: {id: true, title: true, slug: true, viewCount: true, applicationCount: true, company: {select: {name: true}}},
      }),
      db.company.findMany({where: {isBlocked: false}, select: {id: true}, take: CAP + 1}),
    ]);
    const counted = paidAll.slice(0, CAP);
    const recent = counted.filter(o => o.paidAt && o.paidAt >= since);
    const sum = (rows: {amountCents: number}[]) => rows.reduce((total, o) => total + o.amountCents, 0);
    const body: ManageOverview = {
      currency: settings.currency,
      revenueAll: {value: sum(counted), more: paidAll.length > CAP},
      // Every order of the last 30 days is in the newest CAP unless the cap was hit inside them.
      revenue30d: {value: sum(recent), more: paidAll.length > CAP && recent.length === counted.length},
      paidOrders: bounded(paidAll),
      pendingApprovals: bounded(pending, 100),
      activeJobs: bounded(active),
      applications30d: bounded(applications),
      companies: bounded(companies),
      topJobs: top.map(j => ({
        id: j.id,
        title: j.title,
        slug: j.slug,
        company: j.company.name,
        views: j.viewCount,
        applicants: j.applicationCount,
      })),
    };
    return c.json(body);
  }
)
  .get('/activity', rangeQuery, withViewer, requireAuth, requirePermission(PERMISSIONS.BOARD_REPORTS), withDb, async c => {
    const db = c.var.db;
    const {range} = c.req.valid('query');
    const monthly = range === '12m';
    const now = new Date();
    // Newest bucket first; `starts` are the buckets' UTC start instants.
    const starts: number[] = [];
    for (let i = 0; i < RANGES[range]; i++) {
      starts.push(
        monthly
          ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)
          : bucketKey(now, false) - i * DAY_MS
      );
    }
    const since = new Date(starts[starts.length - 1]!);
    const settings = await cachedBoardSettings(db);
    const [paid, refunded, jobs, applications] = await Promise.all([
      db.listingOrder.findMany({
        where: {status: 'paid', currency: settings.currency, paidAt: {gte: since}},
        select: {amountCents: true, paidAt: true},
        orderBy: {paidAt: 'desc'},
        take: ROWS_CAP + 1,
      }),
      db.listingOrder.findMany({
        where: {status: 'refunded', refundedAt: {gte: since}},
        select: {refundedAt: true},
        take: ROWS_CAP + 1,
      }),
      db.job.findMany({
        where: {status: {in: ['published', 'expired', 'closed']}, publishedAt: {gte: since}},
        select: {publishedAt: true},
        orderBy: {publishedAt: 'desc'},
        take: ROWS_CAP + 1,
      }),
      db.application.findMany({
        where: {createdAt: {gte: since}},
        select: {createdAt: true},
        orderBy: {createdAt: 'desc'},
        take: ROWS_CAP + 1,
      }),
    ]);
    const rows = new Map(starts.map(start => [start, {period: new Date(start).toISOString(), revenueCents: 0, paidOrders: 0, refunds: 0, jobsPublished: 0, applications: 0}]));
    const into = (date: Date | null) => (date ? rows.get(bucketKey(date, monthly)) : undefined);
    for (const o of paid.slice(0, ROWS_CAP)) {
      const row = into(o.paidAt);
      if (row) {
        row.revenueCents += o.amountCents;
        row.paidOrders += 1;
      }
    }
    for (const o of refunded.slice(0, ROWS_CAP)) {
      const row = into(o.refundedAt);
      if (row) row.refunds += 1;
    }
    for (const j of jobs.slice(0, ROWS_CAP)) {
      const row = into(j.publishedAt);
      if (row) row.jobsPublished += 1;
    }
    for (const a of applications.slice(0, ROWS_CAP)) {
      const row = into(a.createdAt);
      if (row) row.applications += 1;
    }
    const body: ManageActivity = {
      currency: settings.currency,
      range,
      granularity: monthly ? 'month' : 'day',
      more: [paid, refunded, jobs, applications].some(list => list.length > ROWS_CAP),
      rows: starts.map(start => rows.get(start)!),
    };
    return c.json(body);
  });
