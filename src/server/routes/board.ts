import {Hono} from 'hono';
import {validator} from 'hono/validator';

import type {PrismaClient} from '../../generated/prisma/client';
import {isFooterHref} from '../../lib/types-manage';
import {WORKPLACE_TYPES} from '../../lib/board';
import type {CategoryCount, HomeResponse, PublicBoard, PublicTier} from '../../lib/types-public';
import {cache} from '../../platform/cache';
import {problem, withDb} from '../../platform/guards';
import {getDb} from '../../platform/db';
import {brandCss, cachedBoardSettings, isHexColor} from '../board/brand';
import {publicJobWhere} from '../board/public';
import {CATEGORY_COUNTS_PREFIX, HOME_PREFIX} from '../board/public-cache';
import {featuredCount, moreFeatured, NEWEST, pinnedIds} from '../board/public-search';
import {companySelect, jobSummarySelect, safeUrl, toCompany, toJobSummary} from '../board/public-shapes';
import {type BoardSettings, isSingleCompany} from '../board/settings';
import {companySummaries, hiringRanking} from './companies';

/**
 * Public board data (workstream A). Nothing here reads the visitor.
 *
 *   GET /board/settings     the brand + mode (name, logo, colour, hero, footer links)
 *   GET /board/brand.css    the brand as a stylesheet (F30), linked by the layouts
 *   GET /board/categories   active categories with their open-job counts
 *   GET /board/tiers        active listing tiers (/pricing/); 404 on a single-company board
 *   GET /board/home         the home page's lists (F1)
 */

const HOME_LATEST = 10;
const HOME_COMPANIES = 6;
const MINUTE = 60;
/** Counts change by themselves (jobs expire) and nothing clears them on every change: 10 minutes old is fine. */
const COUNTS_TTL = 10 * MINUTE;
/**
 * The home page's lists: the same for every visitor (nothing here reads the visitor), cleared when
 * a job is published, closed or edited by the routes that do it, and short because jobs also expire
 * and featured periods end by themselves (public-cache.ts).
 */
const HOME_TTL = 3 * MINUTE;

/** Footer links: label ≤ 40, a site path or an https URL, at most 8 (stored as an opaque snapshot). */
const footerLinks = (links: BoardSettings['footerLinks']) =>
  links
    .filter(l => l && typeof l.label === 'string' && typeof l.href === 'string')
    .map(l => ({label: l.label.trim().slice(0, 40), href: l.href.trim()}))
    .filter(l => l.label && isFooterHref(l.href))
    .slice(0, 8);

export const toPublicBoard = (s: BoardSettings): PublicBoard => ({
  name: s.name,
  logoUrl: safeUrl(s.logoUrl),
  primaryColor: isHexColor(s.primaryColor) ? s.primaryColor : '#4f46e5',
  fontPreset: s.fontPreset,
  heroTitle: s.heroTitle,
  heroSubtitle: s.heroSubtitle,
  footerLinks: footerLinks(s.footerLinks),
  currency: s.currency,
  singleCompany: isSingleCompany(s),
  freePostingEnabled: s.freePostingEnabled,
});

/** The single-company scope as a key part: `all` (marketplace) or `company-<id>`. */
const scopeKey = (settings: BoardSettings) => (isSingleCompany(settings) ? `company-${settings.ownerCompanyId}` : 'all');

/** Category counts are an aggregate: kept 10 minutes in the Site Cache (one small public entry per scope). */
function categoryCounts(db: PrismaClient, settings: BoardSettings): Promise<CategoryCount[]> {
  return cache.getOrSet(`${CATEGORY_COUNTS_PREFIX}${scopeKey(settings)}`, COUNTS_TTL, async () => {
    const now = new Date();
    const [categories, grouped] = await Promise.all([
      db.category.findMany({
        where: {isActive: true},
        orderBy: [{sortOrder: 'asc'}, {id: 'asc'}],
        take: 100,
        select: {id: true, slug: true, name: true},
      }),
      db.job.groupBy({
        by: ['categoryId'],
        where: publicJobWhere(settings, now),
        _count: {_all: true},
      }),
    ]);
    const byId = new Map(grouped.map(g => [g.categoryId, g._count._all]));
    return categories.map(cat => ({
      slug: cat.slug,
      name: cat.name,
      jobCount: byId.get(cat.id) ?? 0,
    }));
  });
}

/** The home page's lists (F1), built from the public rule only: no visitor, no drafts. */
async function homeLists(db: PrismaClient, settings: BoardSettings, workplace: string): Promise<HomeResponse> {
  const now = new Date();
  const open = publicJobWhere(settings, now);
  const single = isSingleCompany(settings);
  const [pinned, featuredTotal, latest, categories, owner, ranks] = await Promise.all([
    pinnedIds(db, open, now),
    featuredCount(db, settings, now),
    db.job.findMany({
      where: {
        AND: [open, ...(workplace ? [{workplaceType: workplace}] : [])],
      },
      orderBy: NEWEST,
      take: HOME_LATEST,
      select: jobSummarySelect,
    }),
    categoryCounts(db, settings),
    single
      ? db.company.findFirst({
          where: {id: settings.ownerCompanyId!, isBlocked: false},
          select: companySelect,
        })
      : null,
    // "Hiring now" (marketplace only): the top of the companies directory's order.
    single ? Promise.resolve([]) : hiringRanking(db, settings, now),
  ]);
  // Both depend on the first round only: in parallel.
  const [featured, companies] = await Promise.all([
    pinned.length
      ? db.job.findMany({
          where: {AND: [open, {id: {in: pinned}}]},
          orderBy: NEWEST,
          select: jobSummarySelect,
        })
      : [],
    companySummaries(db, ranks.slice(0, HOME_COMPANIES)),
  ]);
  const map = (rows: typeof featured) => rows.map(r => toJobSummary(r, now, settings.currency));
  return {
    featured: map(featured),
    featuredMore: moreFeatured(featuredTotal),
    featuredCount: featuredTotal,
    workplace,
    latest: map(latest),
    categories,
    companies,
    ownerCompany: owner ? toCompany(owner) : null,
  };
}

export const boardRoutes = new Hono()
  // The board's own logo kept in the Site Database (sites without file storage).
  .get('/logo', withDb, async c => {
    const row = await c.var.db.boardLogo.findUnique({where: {id: 1}, select: {contentType: true, data: true}});
    if (!row) return c.json(problem('not_found', 'No logo.'), 404);
    return new Response(row.data, {
      headers: {'content-type': row.contentType, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400'},
    });
  })
  .get('/settings', withDb, async c => {
    const settings = await cachedBoardSettings(c.var.db);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({board: toPublicBoard(settings)});
  })

  // Linked from every page's <head>: never fails, falls back to the template's own colours.
  .get('/brand.css', async c => {
    const db = getDb();
    const settings = db ? await cachedBoardSettings(db).catch(() => null) : null;
    const css = settings ? brandCss(settings, isSingleCompany(settings)) : '/* No board settings: the default theme. */\n';
    return c.body(css, 200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': settings ? 'public, max-age=60, stale-while-revalidate=600' : 'public, max-age=30',
    });
  })

  .get('/categories', withDb, async c => {
    const db = c.var.db;
    const settings = await cachedBoardSettings(db);
    const categories = await categoryCounts(db, settings);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({categories});
  })

  .get('/tiers', withDb, async c => {
    const db = c.var.db;
    const settings = await cachedBoardSettings(db);
    if (isSingleCompany(settings)) return c.json(problem('not_found', 'This board does not sell listings.'), 404);
    const rows = await db.listingTier.findMany({
      where: {isActive: true},
      orderBy: [{sortOrder: 'asc'}, {id: 'asc'}],
      take: 3,
      select: {
        id: true,
        name: true,
        priceCents: true,
        currency: true,
        durationDays: true,
        includesFeatured: true,
      },
    });
    const tiers: PublicTier[] = rows.map(t => ({
      ...t,
      priceCents: settings.freePostingEnabled ? 0 : t.priceCents,
    }));
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({tiers, freePosting: settings.freePostingEnabled});
  })

  .get(
    '/home',
    // The latest list's workplace switch (F1): '' (any), remote, onsite or hybrid.
    validator('query', v => ({
      workplace: typeof v.workplace === 'string' && (WORKPLACE_TYPES as readonly string[]).includes(v.workplace) ? v.workplace : '',
    })),
    withDb,
    async c => {
      const db = c.var.db;
      const {workplace} = c.req.valid('query');
      const settings = await cachedBoardSettings(db);
      // `workplace` is one of four fixed values (the validator), never free text: a bounded key set.
      const key = `${HOME_PREFIX}${scopeKey(settings)}:${workplace || 'any'}`;
      const body = await cache.getOrSet(key, HOME_TTL, () => homeLists(db, settings, workplace));
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  );
