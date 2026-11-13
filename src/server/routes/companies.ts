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
const CURSOR = /^\d{1,6}\.\d{1,10}$/;

const summarySelect = {id: true, slug: true, name: true, logoUrl: true, location: true, activeJobCount: true} as const;
type SummaryRow = {id: number; slug: string; name: string; logoUrl: string | null; location: string | null};
/** A ranked company: its id and open jobs, and its card's fields when the ranking read them. */
type Rank = {id: number; count: number; row?: SummaryRow};

/**
 * Companies with open jobs, most open jobs first (then id), from `companies.active_job_count`
 * (kept on every write that publishes, closes, expires or deletes a job; recounted by the hourly
 * expiry run): ONE indexed keyset read (`is_blocked, active_job_count DESC, id`) that also carries
 * the cards' fields. `after` is the previous page's last `<count>.<id>`. The home page's
 * "Hiring now" takes the top.
 */
export async function hiringRanking(
  db: PrismaClient,
  settings: BoardSettings,
  _now = new Date(),
  page: {after?: {count: number; id: number}; take?: number} = {}
): Promise<Rank[]> {
  const after = page.after;
  const rows = await db.company.findMany({
    where: {
      isBlocked: false,
      activeJobCount: {gt: 0},
      ...(isSingleCompany(settings) ? {id: settings.ownerCompanyId!} : {}),
      ...(after ? {OR: [{activeJobCount: {lt: after.count}}, {activeJobCount: after.count, id: {gt: after.id}}]} : {}),
    },
    orderBy: [{activeJobCount: 'desc'}, {id: 'asc'}],
    take: Math.min(page.take ?? PAGE + 1, 100),
    select: summarySelect,
  });
  return rows.map(({activeJobCount, ...row}) => ({id: row.id, count: activeJobCount, row}));
}

/** No-op, kept for callers of the old per-isolate memo (there is no module cache any more). */
export const forgetHiringRanking = () => undefined;

/** The ranked companies' cards, in ranking order (blocked ones never rank). No query when the ranking carried them. */
export async function companySummaries(db: PrismaClient, ranks: Rank[]): Promise<PublicCompanySummary[]> {
  if (!ranks.length) return [];
  const missing = ranks.filter(r => !r.row);
  const rows = missing.length
    ? await db.company.findMany({
        where: {id: {in: missing.map(r => r.id)}, isBlocked: false},
        select: {id: true, slug: true, name: true, logoUrl: true, location: true},
        take: missing.length,
      })
    : [];
  const byId = new Map<number, SummaryRow>(rows.map(r => [r.id, r]));
  return ranks.flatMap(rank => {
    const row = rank.row ?? byId.get(rank.id);
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
      const raw = c.req.valid('query').after;
      // Keyset over (count desc, id asc): the rows after the cursor's position.
      const [count, id] = raw ? raw.split('.').map(Number) : [0, 0];
      const ranks = await hiringRanking(db, settings, now, {after: raw ? {count: count!, id: id!} : undefined, take: PAGE + 1});
      const slice = ranks.slice(0, PAGE);
      const more = ranks.length > PAGE;
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
      const slug = c.req.valid('param').slug;
      // Both by slug, in parallel (one round trip): the jobs' rule already leaves out a blocked
      // company and, on a single-company board, every other company.
      const [company, jobs] = await Promise.all([
        db.company.findFirst({
          where: {slug, isBlocked: false, ...(isSingleCompany(settings) ? {id: settings.ownerCompanyId!} : {})},
          select: companySelect,
        }),
        db.job.findMany({
          where: {AND: [publicJobWhere(settings, now), {company: {slug}}]},
          orderBy: [{isFeatured: 'desc'}, ...NEWEST],
          take: PROFILE_JOBS,
          select: jobSummarySelect,
        }),
      ]);
      if (!company) return c.json(problem('not_found', 'No such company.'), 404);
      const body: CompanyProfileResponse = {company: toCompany(company), jobs: jobs.map(r => toJobSummary(r, now, settings.currency))};
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  );
