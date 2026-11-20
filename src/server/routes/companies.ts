import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import type {CompaniesOverview, CompaniesPage, CompanyProfileResponse, PublicCompany, PublicCompanySummary} from '../../lib/types-public';
import {isDbId} from '../../lib/board';
import {getViewer} from '../../platform/auth';
import {cache} from '../../platform/cache';
import {problem, withDb} from '../../platform/guards';
import {cachedBoardSettings} from '../board/brand';
import {publicJobWhere} from '../board/public';
import {HOME_PREFIX} from '../board/public-cache';
import {NEWEST} from '../board/public-search';
import {companySelect, jobState, jobSummarySelect, logoCacheControl, reviveSummary, toCompany, toCompanySummary, toJobSummary} from '../board/public-shapes';
import {type BoardSettings, isSingleCompany} from '../board/settings';

/**
 * Public companies (F5). Only companies with at least one open job are listed; a blocked company
 * is not found. Single-company boards (F39) have no directory (404) and only the owner's profile.
 *
 *   GET /companies?after=<count>.<id>   the directory, most open jobs first, keyset pages
 *   GET /companies?sort=az&after=<id>   … by name instead (the cursor is the last company's id)
 *   GET /companies?q=<text>             … only companies whose name or location contains the text
 *   GET /companies/:slug        a profile + its open jobs
 */

const PAGE = 24;
const PROFILE_JOBS = 100;
const CURSOR = /^\d{1,6}\.\d{1,10}$/;
const AZ_CURSOR = /^\d{1,10}$/;
/** The directory's header strip: this many companies, most open jobs first. */
const TOP = 24;
/** "Hiring the most": this many companies, with a few of their open job titles. */
const TOP_ROLES = 3;
/**
 * The directory's plain first page and its header are the same for every visitor: kept in the Site
 * Cache under the public lists' prefix (every job, company and settings write clears them), and short
 * because jobs expire by themselves. Filtered and later pages read their rows but reuse the header.
 */
const DIRECTORY_TTL = 180;
const DIRECTORY_FIRST_KEY = `${HOME_PREFIX}companies:first`;
const DIRECTORY_OVERVIEW_KEY = `${HOME_PREFIX}companies:overview`;
/** A profile and its open jobs (`board:home:company:<scope>:<slug>`): cleared with the public lists; expiry applied per request. */
const PROFILE_TTL = 600;

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
  page: {after?: {count: number; id: number}; take?: number; where?: Prisma.CompanyWhereInput} = {}
): Promise<Rank[]> {
  const after = page.after;
  const rows = await db.company.findMany({
    where: {
      isBlocked: false,
      ownerSuspended: false,
      activeJobCount: {gt: 0},
      ...(isSingleCompany(settings) ? {id: settings.ownerCompanyId!} : {}),
      ...(after ? {OR: [{activeJobCount: {lt: after.count}}, {activeJobCount: after.count, id: {gt: after.id}}]} : {}),
      ...(page.where ? {AND: [page.where]} : {}),
    },
    orderBy: [{activeJobCount: 'desc'}, {id: 'asc'}],
    take: Math.min(page.take ?? PAGE + 1, 100),
    select: summarySelect,
  });
  return rows.map(({activeJobCount, ...row}) => ({id: row.id, count: activeJobCount, row}));
}

/** The ranked companies' cards, in ranking order (blocked ones never rank). No query when the ranking carried them. */
export async function companySummaries(db: PrismaClient, ranks: Rank[]): Promise<PublicCompanySummary[]> {
  if (!ranks.length) return [];
  const missing = ranks.filter(r => !r.row);
  const rows = missing.length
    ? await db.company.findMany({
        where: {id: {in: missing.map(r => r.id)}, isBlocked: false, ownerSuspended: false},
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

/** A search's filter: the name or the location contains the text (any case). */
const searchWhere = (q: string): Prisma.CompanyWhereInput | undefined =>
  q ? {OR: [{name: {contains: q, mode: 'insensitive'}}, {location: {contains: q, mode: 'insensitive'}}]} : undefined;

/**
 * Companies with open jobs by name (then id), keyset after the company `afterId` (its name is read
 * back: a cursor whose company is gone or blocked ends the list). Index `is_blocked, name, id`.
 */
async function byName(db: PrismaClient, afterId: number | null, where: Prisma.CompanyWhereInput | undefined): Promise<Rank[]> {
  let after: Prisma.CompanyWhereInput | undefined;
  if (afterId != null) {
    const last = await db.company.findFirst({where: {id: afterId, isBlocked: false, ownerSuspended: false}, select: {name: true}});
    if (!last) return [];
    after = {OR: [{name: {gt: last.name}}, {name: last.name, id: {gt: afterId}}]};
  }
  const rows = await db.company.findMany({
    where: {isBlocked: false, ownerSuspended: false, activeJobCount: {gt: 0}, AND: [after ?? {}, where ?? {}]},
    orderBy: [{name: 'asc'}, {id: 'asc'}],
    take: PAGE + 1,
    select: summarySelect,
  });
  return rows.map(({activeJobCount, ...row}) => ({id: row.id, count: activeJobCount, row}));
}

/**
 * The directory's header: totals over every listed company, the top of the ranking (reused when the
 * page itself is that top) and a few open job titles of the first three (one small read each).
 */
async function companiesOverview(db: PrismaClient, settings: BoardSettings, now: Date, firstPage: Rank[] | null): Promise<CompaniesOverview> {
  const [totals, ranks] = await Promise.all([
    db.company.aggregate({where: {isBlocked: false, ownerSuspended: false, activeJobCount: {gt: 0}}, _count: {_all: true}, _sum: {activeJobCount: true}}),
    firstPage ? Promise.resolve(firstPage.slice(0, TOP)) : hiringRanking(db, settings, now, {take: TOP}),
  ]);
  const lead = ranks.slice(0, TOP_ROLES);
  const [top, titles] = await Promise.all([
    companySummaries(db, ranks),
    Promise.all(
      lead.map(rank =>
        db.job.findMany({
          where: {AND: [publicJobWhere(settings, now), {companyId: rank.id}]},
          orderBy: [{isFeatured: 'desc'}, ...NEWEST],
          take: 12,
          select: {title: true},
        })
      )
    ),
  ]);
  const topRoles: Record<string, string[]> = {};
  lead.forEach((rank, i) => {
    const slug = rank.row?.slug;
    if (slug) topRoles[slug] = [...new Set(titles[i]!.map(j => j.title))].slice(0, 3);
  });
  return {companyCount: totals._count._all, roleCount: totals._sum.activeJobCount ?? 0, top, topRoles};
}

type ProfileJobRow = Prisma.JobGetPayload<{select: typeof jobSummarySelect}>;

/**
 * A profile's rows: both by slug, in parallel (one round trip): the jobs' rule already leaves out a
 * blocked company and, on a single-company board, every other company. A company gets a public page
 * once one of its jobs has been live (approved or paid): its text and links are never published by
 * merely signing up and naming a company. Null when there is no such public company.
 */
async function loadProfile(db: PrismaClient, settings: BoardSettings, slug: string, now: Date): Promise<{company: PublicCompany; jobs: ProfileJobRow[]} | null> {
  const [company, jobs] = await Promise.all([
    db.company.findFirst({
      where: {
        slug,
        isBlocked: false,
        ownerSuspended: false,
        ...(isSingleCompany(settings) ? {id: settings.ownerCompanyId!} : {jobs: {some: {publishedAt: {not: null}}}}),
      },
      select: companySelect,
    }),
    db.job.findMany({
      where: {AND: [publicJobWhere(settings, now), {company: {slug}}]},
      orderBy: [{isFeatured: 'desc'}, ...NEWEST],
      take: PROFILE_JOBS,
      select: jobSummarySelect,
    }),
  ]);
  return company ? {company: toCompany(company), jobs} : null;
}

export const companyRoutes = new Hono()
  // A logo kept in the Site Database (sites without file storage): bytes checked on the way in.
  // Public only for a company with a public profile (as `/:slug`): an image uploaded by a company
  // that was never live is not served from the board's origin, except to its own owner (privately).
  .get('/:slug/logo', withDb, async c => {
    const slug = c.req.param('slug');
    if (!/^[a-z0-9-]{1,100}$/.test(slug)) return c.json(problem('not_found', 'No logo.'), 404);
    const settings = await cachedBoardSettings(c.var.db);
    const single = isSingleCompany(settings);
    const row = await c.var.db.companyLogo.findFirst({
      where: {company: {slug, isBlocked: false, ownerSuspended: false, ...(single ? {id: settings.ownerCompanyId!} : {})}},
      select: {
        contentType: true,
        data: true,
        company: {select: {ownerUserId: true, jobs: {where: {publishedAt: {not: null}}, select: {id: true}, take: 1}}},
      },
    });
    const shown = row && (single || row.company.jobs.length > 0);
    const ownerOnly = row && !shown && row.company.ownerUserId !== null && (await getViewer(c.req.raw)).id === row.company.ownerUserId;
    if (!row || (!shown && !ownerOnly)) return c.json(problem('not_found', 'No logo.'), 404);
    return new Response(row.data, {
      headers: {
        'content-type': row.contentType,
        'x-content-type-options': 'nosniff',
        'cache-control': shown ? logoCacheControl(c.req.query('v')) : 'private, no-store',
      },
    });
  })
  .get(
    '/',
    // The id part must fit the database's integer (a bigger one is no cursor, not a 500).
    validator('query', v => {
      const sort = v.sort === 'az' ? 'az' : 'most';
      const after = typeof v.after === 'string' ? v.after : '';
      const valid = sort === 'az' ? AZ_CURSOR.test(after) && isDbId(Number(after)) : CURSOR.test(after) && isDbId(Number(after.split('.')[1]));
      // Spaces collapsed; a longer text than any name or place is cut.
      const q = typeof v.q === 'string' ? v.q.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      return {after: valid ? after : '', sort, q} as const;
    }),
    withDb,
    async c => {
      const db = c.var.db;
      const now = new Date();
      const settings = await cachedBoardSettings(db);
      if (isSingleCompany(settings)) return c.json(problem('not_found', 'There is no companies directory on this board.'), 404);
      const {after: raw, sort, q} = c.req.valid('query');
      // The page itself is the ranking's top when it is the unfiltered first page by open jobs.
      const isTop = sort === 'most' && !raw && !q;
      const load = async (): Promise<CompaniesPage> => {
        const where = searchWhere(q);
        let ranks: Rank[];
        if (sort === 'az') {
          ranks = await byName(db, raw ? Number(raw) : null, where);
        } else {
          // Keyset over (count desc, id asc): the rows after the cursor's position.
          const [count, id] = raw ? raw.split('.').map(Number) : [0, 0];
          ranks = await hiringRanking(db, settings, now, {after: raw ? {count: count!, id: id!} : undefined, take: PAGE + 1, where});
        }
        const slice = ranks.slice(0, PAGE);
        const more = ranks.length > PAGE;
        const last = slice.at(-1);
        const [companies, overview] = await Promise.all([
          companySummaries(db, slice),
          isTop
            ? companiesOverview(db, settings, now, ranks)
            : cache.getOrSet(DIRECTORY_OVERVIEW_KEY, DIRECTORY_TTL, () => companiesOverview(db, settings, now, null)),
        ]);
        return {
          companies,
          nextAfter: more && last ? (sort === 'az' ? String(last.id) : `${last.count}.${last.id}`) : null,
          overview,
        };
      };
      const body = isTop ? await cache.getOrSet(DIRECTORY_FIRST_KEY, DIRECTORY_TTL, load) : await load();
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
      // The same for every visitor: kept in the Site Cache under the public lists' prefix, so every
      // job, company and settings write (they clear it) shows at once. A job that expired since is
      // dropped below with this request's clock, never cached.
      const scope = isSingleCompany(settings) ? `company-${settings.ownerCompanyId}` : 'all';
      const page = await cache.getOrSet(`${HOME_PREFIX}company:${scope}:${slug}`, PROFILE_TTL, () => loadProfile(db, settings, slug, new Date()));
      if (!page) return c.json(problem('not_found', 'No such company.'), 404);
      const jobs = page.jobs.map(reviveSummary).filter(r => jobState(r, now) === 'active');
      const body: CompanyProfileResponse = {company: page.company, jobs: jobs.map(r => toJobSummary(r, now, settings.currency))};
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  );
