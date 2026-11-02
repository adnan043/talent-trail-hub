import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import type {CompaniesPage, CompanyProfileResponse, PublicCompanySummary} from '../../lib/types-public';
import {problem, withDb} from '../../platform/guards';
import {cachedBoardSettings} from '../board/brand';
import {publicJobWhere} from '../board/public';
import {NEWEST} from '../board/public-search';
import {companySelect, jobSummarySelect, toCompany, toCompanySummary, toJobSummary} from '../board/public-shapes';
import {type BoardSettings, isSingleCompany} from '../board/settings';

/**
 * Public companies (F5). Only companies with at least one open job are listed; a blocked company
 * is not found. Single-company boards (F39) have no directory (404) and only the owner's profile.
 *
 *   GET /companies?after=<count>.<id>   the directory, most open jobs first, keyset pages
 *   GET /companies/:slug        a profile + its open jobs
 */

const PAGE = 24;
const PROFILE_JOBS = 100;
/** Companies ranked: far above a real board's hiring companies; the rest are left out. */
const RANK_MAX = 2000;
const RANK_TTL_MS = 60_000;
const CURSOR = /^\d{1,6}\.\d{1,10}$/;

type Rank = {id: number; count: number};
let ranking: {at: number; scope: number | null; value: Rank[]} | null = null;

/**
 * Companies with open jobs, most open jobs first (then id): ONE bounded `groupBy` over the public
 * jobs, kept 60 s per isolate (a small public list of ids and counts). The directory pages through
 * it with a `<count>.<id>` keyset cursor; the home page's "Hiring now" takes its top.
 */
export async function hiringRanking(db: PrismaClient, settings: BoardSettings, now = new Date()): Promise<Rank[]> {
  const scope = isSingleCompany(settings) ? settings.ownerCompanyId : null;
  if (ranking && ranking.scope === scope && now.getTime() - ranking.at < RANK_TTL_MS) return ranking.value;
  const groups = await db.job.groupBy({
    by: ['companyId'],
    where: publicJobWhere(settings, now),
    _count: {companyId: true},
    orderBy: [{_count: {companyId: 'desc'}}, {companyId: 'asc'}],
    take: RANK_MAX,
  });
  const value = groups.map(g => ({id: g.companyId, count: g._count.companyId}));
  ranking = {at: now.getTime(), scope, value};
  return value;
}

/** Drops the ranking cache (tests). */
export const forgetHiringRanking = () => {
  ranking = null;
};

/** The ranked companies' cards, in ranking order (blocked ones never rank: publicJobWhere). */
export async function companySummaries(db: PrismaClient, ranks: Rank[]): Promise<PublicCompanySummary[]> {
  if (!ranks.length) return [];
  const rows = await db.company.findMany({
    where: {id: {in: ranks.map(r => r.id)}, isBlocked: false},
    select: {id: true, slug: true, name: true, logoUrl: true, location: true},
  });
  const byId = new Map(rows.map(r => [r.id, r]));
  return ranks.flatMap(rank => {
    const row = byId.get(rank.id);
    return row ? [toCompanySummary(row, rank.count)] : [];
  });
}

export const companyRoutes = new Hono()
  // A logo kept in the Site Database (sites without file storage): bytes checked on the way in.
  .get('/:slug/logo', withDb, async c => {
    const row = await c.var.db.companyLogo.findFirst({
      where: {company: {slug: c.req.param('slug'), isBlocked: false}},
      select: {contentType: true, data: true},
    });
    if (!row) return c.json(problem('not_found', 'No logo.'), 404);
    return new Response(row.data, {
      headers: {'content-type': row.contentType, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400'},
    });
  })
  .get(
    '/',
    validator('query', v => ({after: typeof v.after === 'string' && CURSOR.test(v.after) ? v.after : ''})),
    withDb,
    async c => {
      const db = c.var.db;
      const now = new Date();
      const settings = await cachedBoardSettings(db);
      if (isSingleCompany(settings)) return c.json(problem('not_found', 'There is no companies directory on this board.'), 404);
      const ranks = await hiringRanking(db, settings, now);
      const after = c.req.valid('query').after;
      // Keyset over (count desc, id asc): the first rank after the cursor's position.
      const [count, id] = after ? after.split('.').map(Number) : [Infinity, 0];
      const start = after ? ranks.findIndex(r => r.count < count! || (r.count === count && r.id > id!)) : 0;
      const slice = start < 0 ? [] : ranks.slice(start, start + PAGE);
      const more = start >= 0 && ranks.length > start + PAGE;
      const last = slice.at(-1);
      const body: CompaniesPage = {
        companies: await companySummaries(db, slice),
        nextAfter: more && last ? `${last.count}.${last.id}` : null,
      };
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  )

  .get(
    '/:slug',
    validator('param', (v, c) => {
      const slug = String(v.slug ?? '');
      return /^[a-z0-9-]{1,100}$/.test(slug) ? {slug} : c.json(problem('not_found', 'No such company.'), 404);
    }),
    withDb,
    async c => {
      const db = c.var.db;
      const now = new Date();
      const settings = await cachedBoardSettings(db);
      const company = await db.company.findFirst({
        where: {
          slug: c.req.valid('param').slug,
          isBlocked: false,
          ...(isSingleCompany(settings) ? {id: settings.ownerCompanyId!} : {}),
        },
        select: companySelect,
      });
      if (!company) return c.json(problem('not_found', 'No such company.'), 404);
      const jobs = await db.job.findMany({
        where: {AND: [publicJobWhere(settings, now), {companyId: company.id}]},
        orderBy: [{isFeatured: 'desc'}, ...NEWEST],
        take: PROFILE_JOBS,
        select: jobSummarySelect,
      });
      const body: CompanyProfileResponse = {company: toCompany(company), jobs: jobs.map(r => toJobSummary(r, now, settings.currency))};
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  );
