import {Hono} from 'hono';
import {validator} from 'hono/validator';

import {LIMITS} from '../../lib/board';
import {parseJobSearch, toApiQuery} from '../../lib/job-search';
import type {JobDetailResponse, JobsPage, SitemapResponse} from '../../lib/types-public';
import {problem, withDb} from '../../platform/guards';
import {cachedBoardSettings} from '../board/brand';
import {ipHashOf} from '../board/ip';
import {publicJobWhere} from '../board/public';
import {cursorHour, cursorWhere, encodeCursor, featuredCount, moreFeatured, NEWEST, orderFor, pinHour, pinnedIds, searchWhere} from '../board/public-search';
import {jobDetailSelect, jobSummarySelect, toJobDetail, toJobSummary} from '../board/public-shapes';
import {isSingleCompany} from '../board/settings';

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
      const [pinned, featuredTotal] = await Promise.all([
        search.featured ? Promise.resolve([] as number[]) : pinnedIds(db, where, now, new Date(hour * 3_600_000)),
        firstPage ? featuredCount(db, settings, now) : Promise.resolve(0),
      ]);
      const shown = firstPage ? pinned : [];
      const take = LIMITS.pageSize - shown.length;
      const orderBy = orderFor(search.sort);
      const restWhere = {AND: [where, ...(pinned.length ? [{id: {notIn: pinned}}] : []), ...(after ? [after] : [])]};
      const [top, rest] = await Promise.all([
        shown.length ? db.job.findMany({where: {AND: [where, {id: {in: shown}}]}, orderBy, select: jobSummarySelect}) : [],
        db.job.findMany({where: restWhere, orderBy, take: take + 1, select: jobSummarySelect}),
      ]);
      const page = rest.slice(0, take);
      const last = page.at(-1);
      const body: JobsPage = {
        jobs: [...top, ...page].map(row => toJobSummary(row, now, settings.currency)),
        pinned: top.length,
        nextBefore: rest.length > take && last ? encodeCursor(search.sort, last, hour) : null,
        featuredMore: moreFeatured(featuredTotal),
        featuredCount: featuredTotal,
      };
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(body);
    }
  )

  .get('/sitemap', withDb, async c => {
    const db = c.var.db;
    const now = new Date();
    const settings = await cachedBoardSettings(db);
    const open = publicJobWhere(settings, now);
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
    const body: SitemapResponse = {jobs: iso(jobs), companies: iso(companies), marketplace};
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
    const settings = await cachedBoardSettings(db);
    const row = await db.job.findFirst({where: {...pageWhere(settings, now), slug: c.req.valid('param').slug}, select: jobDetailSelect});
    if (!row) return c.json(problem('not_found', 'No such job.'), 404);
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
    const map = (rows: typeof similar) => rows.map(r => toJobSummary(r, now, settings.currency));
    const body: JobDetailResponse = {job: toJobDetail(row, now, settings.currency), similar: map(similar), moreAtCompany: map(more)};
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(body);
  })

  .post('/:slug/view', slugParam, withDb, async c => {
    const db = c.var.db;
    const now = new Date();
    const {slug} = c.req.valid('param');
    // At most one counted view per visitor (keyed IP hash) and job a day: the attempt row's key is
    // the SHA-256 of the IP hash and the slug. A quick indexed lookup (in parallel with the settings)
    // skips the usual repeat; the atomic insert below decides.
    const ipHash = await ipHashOf(c);
    const key = ipHash ? await sha256Hex(`${ipHash}:job:${slug}`) : null;
    const [settings, seen] = await Promise.all([
      cachedBoardSettings(db),
      key
        ? db.boardAttempt.findFirst({where: {kind: 'view', ipHash: key, createdAt: {gt: new Date(now.getTime() - 86_400_000)}}, select: {id: true}})
        : null,
    ]);
    if (seen) return c.json({ok: true});
    const job = await db.job.findFirst({where: {...publicJobWhere(settings, now), slug}, select: {id: true}});
    if (!job) return c.json({ok: true});
    if (key) {
      // Record the (visitor, job, day) attempt FIRST, atomically: under a transaction-scoped
      // advisory lock on the key, insert only when none exists today. A parallel burst inserts
      // (and so counts) once.
      const since = new Date(now.getTime() - 86_400_000);
      // A view is a vanity metric: a failed or contended attempt is simply not counted.
      const inserted = await db
        .$transaction([
          db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
          db.$executeRaw`INSERT INTO board_attempts (kind, ip_hash, created_at)
            SELECT 'view', ${key}, now()
            WHERE NOT EXISTS (SELECT 1 FROM board_attempts WHERE kind = 'view' AND ip_hash = ${key} AND created_at > ${since})`,
        ])
        .then(([, count]) => count)
        .catch(() => 0);
      if (inserted !== 1) return c.json({ok: true});
    }
    // Raw by id, NOT updateMany: Prisma's @updatedAt would move `updated_at` (the sitemap's lastmod).
    await db.$executeRaw`UPDATE jobs SET view_count = view_count + 1 WHERE id = ${job.id}`;
    return c.json({ok: true});
  });
