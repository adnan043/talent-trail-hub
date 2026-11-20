import {type Context, Hono} from 'hono';
import {validator} from 'hono/validator';

import {Prisma, type PrismaClient} from '../../generated/prisma/client';
import {LIMITS} from '../../lib/board';
import {type JobSearch, parseJobSearch, toApiQuery} from '../../lib/job-search';
import type {JobDetailResponse, JobsPage, SitemapResponse} from '../../lib/types-public';
import {cache} from '../../platform/cache';
import {problem, withDb} from '../../platform/guards';
import {after} from '../board/after';
import {cachedBoardSettings} from '../board/brand';
import {ipHashOf} from '../board/ip';
import {publicJobWhere} from '../board/public';
import {HOME_PREFIX, SITEMAP_KEY} from '../board/public-cache';
import {cursorHour, cursorWhere, encodeCursor, FEATURED_COUNT_CAP, featuredIds, featuredPinsAndCount, idsMatchingKeyword, moreFeatured, NEWEST, orderFor, pinHour, pinnedIds, searchWhere} from '../board/public-search';
import {jobDetailSelect, jobState, jobSummarySelect, reviveSummary, toJobDetail, toJobSummary} from '../board/public-shapes';
import {type BoardSettings, isSingleCompany} from '../board/settings';

/**
 * Public jobs (workstream A). Every read starts from `publicJobWhere` (published, unexpired,
 * company not blocked, single-company scope). Answers read no visitor: short public caching.
 *
 *   GET  /jobs              search + filters, keyset pages, featured pins on page 1 (F2)
 *   GET  /jobs/sitemap      open jobs + hiring companies for /sitemap.xml (F34)
 *   POST /jobs/saved        the saved slugs still on the board, expired ones flagged (F6)
 *   GET  /jobs/:slug        one job (open, expired or closed), similar jobs (F3)
 *   POST /jobs/:slug/view   +1 view (the page sends it once per browser session)
 */

const SLUG = /^[a-z0-9-]{1,120}$/;
const SIMILAR = 3;
const MORE_AT_COMPANY = 5;
const MAX_SAVED = 100;
const SITEMAP_JOBS = 5000;
const SITEMAP_COMPANIES = 1000;
/** The sitemap is public and crawlers tolerate an hour: time-based (also cleared on job and settings changes). */
const SITEMAP_TTL = 3600;
/** The plain first page of /jobs/, as the home lists: jobs expire and featured periods end by themselves. */
const JOBS_FIRST_PAGE_TTL = 180;
/**
 * One job's page (the job, similar jobs, more at the company). Cleared by every write that clears the
 * public lists; expiry and featured periods are applied per request, so the TTL only bounds how long
 * an expired neighbour can leave a list one row short.
 */
const JOB_PAGE_TTL = 600;

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');

const slugParam = validator('param', (v, c) => {
  const slug = String(v.slug ?? '');
  return SLUG.test(slug) ? {slug} : c.json(problem('not_found', 'No such job.'), 404);
});

const savedBody = validator('json', (value, c) => {
  const raw = (value as {slugs?: unknown})?.slugs;
  if (!Array.isArray(raw) || raw.length > MAX_SAVED) {
    return c.json(problem('invalid_input', `Send up to ${MAX_SAVED} saved jobs.`), 422);
  }
  const slugs = [...new Set(raw.filter((s): s is string => typeof s === 'string' && SLUG.test(s)))];
  return {slugs};
});

/**
 * Which jobs keep a page (F3): every live job (`publicJobWhere`), and an expired or closed one
 * (or published past `expiresAt`) only while `needsReview` is false. An edit to a job that is
 * not live waits for review, so unreviewed content is never served at the approved URL.
 * Drafts, pending and rejected jobs have no page.
 */
const pageWhere = (settings: Parameters<typeof publicJobWhere>[0], now: Date) => ({
  OR: [
    publicJobWhere(settings, now),
    {...publicJobWhere(settings, now), status: {in: ['published', 'expired', 'closed']}, expiresAt: undefined, needsReview: false},
  ],
});

export const jobRoutes = new Hono()
  .get(
    '/',
    validator('query', v => toApiQuery(parseJobSearch(v))),
    withDb,
    async c => {
      const db = c.var.db;
      const now = new Date();
      const search = parseJobSearch(c.req.valid('query'));
      const settings = await cachedBoardSettings(db);
      const where = searchWhere(search, settings, now);
      const after = search.before ? cursorWhere(search.sort, search.before) : null;
      const firstPage = !after;
      // Featured jobs are pinned on page 1 and left out of every page's main list (F2). Later pages
      // use page 1's hour (carried in the cursor), so the same jobs stay out across an hour change.
      const hour = (after && cursorHour(search.before)) || pinHour(now);
      const seedAt = new Date(hour * 3_600_000);
      // No filter (`searchWhere` is the public rule alone) on page 1: the pins and the count read the
      // same rows, so one read serves both.
      const unfiltered = firstPage && Array.isArray(where.AND) && where.AND.length === 1;
      const scope = isSingleCompany(settings) ? `company-${settings.ownerCompanyId}` : 'all';
      const load = async (): Promise<JobsPage> => {
        const orderBy = orderFor(search.sort);
        // The salary sort's cursor key (a bigint, kept out of the shared select and the JSON).
        const listSelect = {...jobSummarySelect, salarySortCents: true} as const;
        // ONE parallel trip: the pins (ids), the board's featured count and the list itself. The list
        // can't leave the pins out in SQL before they are known, so it reads `featuredPinCap` rows
        // more and drops them here (at most that many pins).
        const [[pinned, featuredTotal], rows] = await Promise.all([
          unfiltered
            ? featuredPinsAndCount(db, settings, now, seedAt).then(r => [r.pinned, r.count] as const)
            : boardFeaturedIds(db, settings, now, scope).then(
                async ids =>
                  [
                    search.featured ? [] : await filteredPins(db, search, settings, ids, now, seedAt),
                    firstPage ? Math.min(ids.length, FEATURED_COUNT_CAP) : 0,
                  ] as const
              ),
          db.job.findMany({
            where: after ? {AND: [where, after]} : where,
            orderBy,
            take: LIMITS.pageSize + LIMITS.featuredPinCap + 1,
            select: listSelect,
            // A keyword (trigram on long text) matches far more rows than the planner expects, so a
            // joined read built every match's company and tags before the sort cut the page (2x the
            // time at 5k jobs, growing with the board): read the page first, then its relations.
            ...(search.q ? {relationLoadStrategy: 'query' as const} : {}),
          }),
        ]);
        const shown = firstPage ? pinned : [];
        const take = LIMITS.pageSize - shown.length;
        const pins = new Set(pinned);
        const rest = rows.filter(row => !pins.has(row.id));
        const page = rest.slice(0, take);
        // The pinned rows, in the list's order: from the rows just read when all are there (often, on
        // a narrow search), else one more read of exactly those.
        const found = rows.filter(row => shown.includes(row.id));
        const top =
          found.length === shown.length ? found : await db.job.findMany({where: {AND: [where, {id: {in: shown}}]}, orderBy, select: listSelect});
        const last = page.at(-1);
        const body: JobsPage = {
          jobs: [...top, ...page].map(row => toJobSummary(row, now, settings.currency)),
          pinned: top.length,
          nextBefore: rest.length > take && last ? encodeCursor(search.sort, last, hour) : null,
          featuredMore: moreFeatured(featuredTotal),
          featuredCount: featuredTotal,
        };
        return body;
      };
      // The plain first page (the /jobs/ page as most visitors open it) is the same for everyone:
      // kept 3 minutes in the Site Cache under the home lists' prefix, so every job write that
      // clears those (`forgetPublicLists`) clears it too. Per sort and per pin hour (the pins rotate
      // hourly). Filtered and later pages are too many shapes to cache: they read the database.
      const body = unfiltered ? await cache.getOrSet(`${HOME_PREFIX}jobs:${scope}:${search.sort}:${hour}`, JOBS_FIRST_PAGE_TTL, load) : await load();
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  )

  .get('/sitemap', withDb, async c => {
    const db = c.var.db;
    const settings = await cachedBoardSettings(db);
    // Dates are cached as the ISO strings the answer carries (JSON-safe). A board too big for one
    // cache value (256 KB) is simply not stored: every request reads the database, as before.
    const body = await cache.getOrSet(SITEMAP_KEY, SITEMAP_TTL, async (): Promise<SitemapResponse> => {
      const open = publicJobWhere(settings, new Date());
      const marketplace = !isSingleCompany(settings);
      const [jobs, companies] = await Promise.all([
        db.job.findMany({where: open, orderBy: NEWEST, take: SITEMAP_JOBS, select: {slug: true, updatedAt: true}}),
        marketplace
          ? db.company.findMany({
              where: {isBlocked: false, jobs: {some: open}},
              orderBy: {id: 'desc'},
              take: SITEMAP_COMPANIES,
              select: {slug: true, updatedAt: true},
            })
          : [],
      ]);
      const iso = (rows: {slug: string; updatedAt: Date}[]) => rows.map(r => ({slug: r.slug, updatedAt: r.updatedAt.toISOString()}));
      return {jobs: iso(jobs), companies: iso(companies), marketplace};
    });
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(body);
  })

  .post('/saved', savedBody, withDb, async c => {
    const db = c.var.db;
    const now = new Date();
    const {slugs} = c.req.valid('json');
    if (!slugs.length) return c.json({jobs: []});
    const settings = await cachedBoardSettings(db);
    const rows = await db.job.findMany({
      where: {...pageWhere(settings, now), slug: {in: slugs}},
      take: MAX_SAVED,
      select: jobSummarySelect,
    });
    return c.json({jobs: rows.map(row => toJobSummary(row, now, settings.currency))});
  })

  .get('/:slug', slugParam, withDb, async c => {
    const db = c.var.db;
    const now = new Date();
    const {slug} = c.req.valid('param');
    const settings = await cachedBoardSettings(db);
    // The job and its two lists (3 billed queries in 2 trips) are the same for every visitor: kept in
    // the Site Cache under the public lists' prefix, so every job, company and settings write that
    // clears those (`forgetPublicLists`) clears it too. What changes by itself (expiry, a featured
    // period ending) is worked out below from THIS request's clock, never cached.
    const scope = isSingleCompany(settings) ? `company-${settings.ownerCompanyId}` : 'all';
    const cached = await cache.getOrSet(`${HOME_PREFIX}job:${scope}:${slug}`, JOB_PAGE_TTL, () => loadJobPage(db, settings, slug, new Date()));
    const page = cached ? reviveJobPage(cached) : null;
    if (!page || !onPageNow(page.row, now)) return c.json(problem('not_found', 'No such job.'), 404);
    // A listed job that expired since it was cached has left the board: dropped, as a fresh read would.
    const map = (rows: SummaryRow[]) => rows.filter(r => jobState(r, now) === 'active').map(r => toJobSummary(r, now, settings.currency));
    const body: JobDetailResponse = {job: toJobDetail(page.row, now, settings.currency), similar: map(page.similar), moreAtCompany: map(page.more)};
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(body);
  })

  .post('/:slug/view', slugParam, withDb, async c => {
    const db = c.var.db;
    const {slug} = c.req.valid('param');
    // Answered at once; the count runs after the answer (a vanity metric: a failed or contended
    // attempt is simply not counted).
    after(c, 'job view', () => countView(c, db, slug));
    return c.json({ok: true});
  });

/**
 * The whole board's featured job ids: the only jobs a filtered or later page can pin, and (capped)
 * the featured count on a filtered page 1 ("See all 12 featured jobs"). The same for every search,
 * so one cached list instead of a read per search. Featured periods end by themselves, so a short
 * TTL (as the first page's), and the pins are still checked against the clock (`filteredPins`); job
 * writes clear it with the public lists.
 */
const boardFeaturedIds = (db: PrismaClient, settings: BoardSettings, now: Date, scope: string) =>
  cache.getOrSet(`${HOME_PREFIX}featured-ids:${scope}`, JOBS_FIRST_PAGE_TTL, () => featuredIds(db, settings, now));

/**
 * The pins of a filtered (or later) page: the board's featured jobs that match the search. No
 * featured jobs, no read. A keyword is matched on those few rows by id first (`idsMatchingKeyword`),
 * then the other filters, so neither read walks every keyword match on the board.
 */
async function filteredPins(db: PrismaClient, search: JobSearch, settings: BoardSettings, featured: number[], now: Date, seedAt: Date): Promise<number[]> {
  const candidates = search.q ? await idsMatchingKeyword(db, featured, search.q) : featured;
  if (!candidates.length) return [];
  return pinnedIds(db, {AND: [searchWhere({...search, q: ''}, settings, now), {id: {in: candidates}}]}, now, seedAt);
}

type SummaryRow = Prisma.JobGetPayload<{select: typeof jobSummarySelect}>;
const jobPageSelect = {...jobDetailSelect, needsReview: true} as const;
type JobPageRow = Prisma.JobGetPayload<{select: typeof jobPageSelect}>;
interface JobPageRows {
  row: JobPageRow;
  similar: SummaryRow[];
  more: SummaryRow[];
}

/** One job's page rows: the job (open, expired or closed: `pageWhere`), then its two short lists. */
async function loadJobPage(db: PrismaClient, settings: Parameters<typeof publicJobWhere>[0], slug: string, now: Date): Promise<JobPageRows | null> {
  const row = await db.job.findFirst({where: {...pageWhere(settings, now), slug}, select: jobPageSelect});
  if (!row) return null;
  const open = publicJobWhere(settings, now);
  const [similar, more] = await Promise.all([
    db.job.findMany({
      where: {AND: [open, {categoryId: row.categoryId, id: {not: row.id}, companyId: {not: row.companyId}}]},
      orderBy: [{isFeatured: 'desc'}, ...NEWEST],
      take: SIMILAR,
      select: jobSummarySelect,
    }),
    db.job.findMany({
      where: {AND: [open, {companyId: row.companyId, id: {not: row.id}}]},
      orderBy: NEWEST,
      take: MORE_AT_COMPANY,
      select: jobSummarySelect,
    }),
  ]);
  return {row, similar, more};
}

function reviveJobPage(page: JobPageRows): JobPageRows {
  const row = reviveSummary(page.row);
  return {
    row: {...row, updatedAt: new Date(row.updatedAt), company: {...row.company, updatedAt: new Date(row.company.updatedAt)}},
    similar: page.similar.map(reviveSummary),
    more: page.more.map(reviveSummary),
  };
}

/**
 * `pageWhere` again with this request's clock, for a cached row (company and board scope are cleared
 * on write): a live job keeps its page; one past its end only while no edit awaits review.
 */
const onPageNow = (row: JobPageRow, now: Date) =>
  (row.status === 'published' && row.expiresAt !== null && row.expiresAt > now) ||
  (['published', 'expired', 'closed'].includes(row.status) && !row.needsReview);

/**
 * +1 view, at most once per visitor (keyed IP hash) and job a day: the attempt row's key is the
 * SHA-256 of the IP hash and the slug. ONE short transaction (one batch): a transaction-scoped
 * advisory lock on the key, then ONE statement that records the attempt only when none exists
 * today AND the job is public, and bumps the counter only when it did. A parallel burst counts once.
 * Raw SQL, not updateMany: Prisma's @updatedAt would move `updated_at` (the sitemap's lastmod).
 */
async function countView(c: Context, db: PrismaClient, slug: string): Promise<void> {
  const [ipHash, settings] = await Promise.all([ipHashOf(c), cachedBoardSettings(db)]);
  const key = ipHash ? await sha256Hex(`${ipHash}:job:${slug}`) : null;
  // `publicJobWhere` in SQL: published, unexpired, company not blocked, the single-company scope.
  const scope = isSingleCompany(settings) ? settings.ownerCompanyId : null;
  const job = Prisma.sql`
    SELECT j."id" FROM "jobs" j JOIN "companies" co ON co."id" = j."company_id"
    WHERE j."slug" = ${slug} AND j."status" = 'published' AND j."expires_at" > now() AND co."is_blocked" = false
      AND (${scope}::int IS NULL OR j."company_id" = ${scope}::int)`;
  if (!key) {
    // No secret to key visitors by (local only): count without the daily check.
    await db.$executeRaw`UPDATE "jobs" SET "view_count" = "view_count" + 1 WHERE "id" = (${job})`;
    return;
  }
  const since = new Date(Date.now() - 86_400_000);
  await db.$transaction([
    db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
    db.$executeRaw`
      WITH job AS (${job}),
      seen AS (
        INSERT INTO "board_attempts" ("kind", "ip_hash", "created_at")
        SELECT 'view', ${key}, now() FROM job
        WHERE NOT EXISTS (SELECT 1 FROM "board_attempts" WHERE "kind" = 'view' AND "ip_hash" = ${key} AND "created_at" > ${since})
        RETURNING 1
      )
      UPDATE "jobs" SET "view_count" = "view_count" + 1
      WHERE "id" = (SELECT "id" FROM job) AND EXISTS (SELECT 1 FROM seen)`,
  ]);
}
