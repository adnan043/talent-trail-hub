import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Bounded, ManageActivity, ManageOverview} from '../../lib/types-manage';
import {requireAuth, requirePermission, withDb, withViewer} from '../../platform/guards';
import {PERMISSIONS} from '../permissions';
import {DAY_MS} from './manage-shared';
import {cachedBoardSettings} from './brand';
import {cache} from '../../platform/cache';

/**
 * F19 overview numbers and the activity chart. Each is ONE aggregate `$queryRaw` (counted in the
 * database, never thousands of rows loaded to count here; docs/agent/performance.md) over indexed
 * columns, and kept in the Site Cache for a short time (docs/agent/cache.md): reports may be a
 * couple of minutes old, and nothing per viewer is in them (the route checks the permission first).
 */
const TOP_JOBS = 5;
const REPORT_TTL = 120; // seconds: time-based, nothing clears it

const RANGES = {'7d': 7, '30d': 30, '90d': 90, '12m': 12} as const;
type Range = keyof typeof RANGES;

const rangeQuery = validator('query', v => ({
  range: (typeof v.range === 'string' && v.range in RANGES ? v.range : '30d') as Range,
}));

/** Start of the UTC day (or month) the instant falls in, as the bucket's key. */
const bucketKey = (date: Date, monthly: boolean) =>
  monthly ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const exact = (value: number | bigint | null): Bounded => ({value: Number(value ?? 0), more: false});

export const manageOverviewRoutes = new Hono()
  .get(
  '/',
  withViewer,
  requireAuth,
  requirePermission(PERMISSIONS.BOARD_REPORTS),
  withDb,
  async c => {
    const db = c.var.db;
    const settings = await cachedBoardSettings(db);
    const body = await cache.getOrSet(`report:overview:${settings.currency}`, REPORT_TTL, async (): Promise<ManageOverview> => {
      const now = new Date();
      const since = new Date(now.getTime() - 30 * DAY_MS);
      type Totals = {revenue_all: bigint | null; revenue_30d: bigint | null; paid_orders: number; pending: number; active: number; applications: number; companies: number};
      const [[totals], top] = await Promise.all([
        db.$queryRaw<Totals[]>`
          SELECT
            (SELECT sum("amount_cents")::bigint FROM "listing_orders" WHERE "status" = 'paid' AND "currency" = ${settings.currency}) AS revenue_all,
            (SELECT sum("amount_cents")::bigint FROM "listing_orders" WHERE "status" = 'paid' AND "currency" = ${settings.currency} AND "paid_at" >= ${since}) AS revenue_30d,
            (SELECT count(*)::int FROM "listing_orders" WHERE "status" = 'paid' AND "currency" = ${settings.currency}) AS paid_orders,
            (SELECT count(*)::int FROM "jobs" WHERE "status" = 'pending_review') AS pending,
            (SELECT count(*)::int FROM "jobs" WHERE "status" = 'published' AND "expires_at" > ${now}) AS active,
            (SELECT count(*)::int FROM "applications" WHERE "created_at" >= ${since}) AS applications,
            (SELECT count(*)::int FROM "companies" WHERE NOT "is_blocked") AS companies`,
        db.job.findMany({
          where: {status: 'published', expiresAt: {gt: now}},
          orderBy: [{viewCount: 'desc'}, {id: 'desc'}],
          take: TOP_JOBS,
          select: {id: true, title: true, slug: true, viewCount: true, applicationCount: true, company: {select: {name: true}}},
        }),
      ]);
      return {
        currency: settings.currency,
        revenueAll: exact(totals?.revenue_all ?? 0),
        revenue30d: exact(totals?.revenue_30d ?? 0),
        paidOrders: exact(totals?.paid_orders ?? 0),
        pendingApprovals: exact(totals?.pending ?? 0),
        activeJobs: exact(totals?.active ?? 0),
        applications30d: exact(totals?.applications ?? 0),
        companies: exact(totals?.companies ?? 0),
        topJobs: top.map(j => ({id: j.id, title: j.title, slug: j.slug, company: j.company.name, views: j.viewCount, applicants: j.applicationCount})),
      };
    });
    return c.json(body);
  }
)
  .get('/activity', rangeQuery, withViewer, requireAuth, requirePermission(PERMISSIONS.BOARD_REPORTS), withDb, async c => {
    const db = c.var.db;
    const {range} = c.req.valid('query');
    const settings = await cachedBoardSettings(db);
    const body = await cache.getOrSet(`report:activity:${range}:${settings.currency}`, REPORT_TTL, async (): Promise<ManageActivity> => {
      const monthly = range === '12m';
      const unit = monthly ? 'month' : 'day';
      const now = new Date();
      // Newest bucket first; `starts` are the buckets' UTC start instants.
      const starts: number[] = [];
      for (let i = 0; i < RANGES[range]; i++) {
        starts.push(monthly ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1) : bucketKey(now, false) - i * DAY_MS);
      }
      const since = new Date(starts[starts.length - 1]!);
      // One statement: each source bucketed by UTC day/month in the database (indexes: listing_orders
      // (status, paid_at), jobs (status, published_at), applications (created_at)).
      type Bucket = {kind: string; bucket: bigint; n: number; cents: bigint | null};
      const buckets = await db.$queryRaw<Bucket[]>`
        SELECT 'paid' AS kind, (extract(epoch FROM date_trunc(${unit}, "paid_at" AT TIME ZONE 'UTC')) * 1000)::bigint AS bucket, count(*)::int AS n, sum("amount_cents")::bigint AS cents
          FROM "listing_orders" WHERE "status" = 'paid' AND "currency" = ${settings.currency} AND "paid_at" >= ${since} GROUP BY 2
        UNION ALL
        SELECT 'refund', (extract(epoch FROM date_trunc(${unit}, "refunded_at" AT TIME ZONE 'UTC')) * 1000)::bigint, count(*)::int, NULL
          FROM "listing_orders" WHERE "status" = 'refunded' AND "refunded_at" >= ${since} GROUP BY 2
        UNION ALL
        SELECT 'job', (extract(epoch FROM date_trunc(${unit}, "published_at" AT TIME ZONE 'UTC')) * 1000)::bigint, count(*)::int, NULL
          FROM "jobs" WHERE "status" IN ('published', 'expired', 'closed') AND "published_at" >= ${since} GROUP BY 2
        UNION ALL
        SELECT 'application', (extract(epoch FROM date_trunc(${unit}, "created_at" AT TIME ZONE 'UTC')) * 1000)::bigint, count(*)::int, NULL
          FROM "applications" WHERE "created_at" >= ${since} GROUP BY 2`;
      const rows = new Map(starts.map(start => [start, {period: new Date(start).toISOString(), revenueCents: 0, paidOrders: 0, refunds: 0, jobsPublished: 0, applications: 0}]));
      for (const b of buckets) {
        // The bucket's UTC start, in epoch milliseconds (the same key as `starts`).
        const row = rows.get(Number(b.bucket));
        if (!row) continue;
        if (b.kind === 'paid') {
          row.paidOrders += b.n;
          row.revenueCents += Number(b.cents ?? 0);
        } else if (b.kind === 'refund') row.refunds += b.n;
        else if (b.kind === 'job') row.jobsPublished += b.n;
        else row.applications += b.n;
      }
      return {currency: settings.currency, range, granularity: monthly ? 'month' : 'day', more: false, rows: starts.map(start => rows.get(start)!)};
    });
    return c.json(body);
  });
