import type {MiddlewareHandler} from 'hono';

import {cache} from '../../platform/cache';

/**
 * Site Cache keys of the PUBLIC job lists (docs/agent/cache.md). Each holds only what every
 * visitor sees (no viewer is read), so a shared key is safe. They change by themselves (a job
 * expires, a featured period ends), so their TTLs are short; the writes we control also clear them.
 *
 *   board:home:<any|remote|onsite|hybrid>   GET /board/home            3 min
 *   board:home:jobs:<scope>:<sort>:<hour>  GET /jobs, the plain first page   3 min
 *   board:home:featured-ids:<scope>        the board's featured job ids: pins of filtered and later pages, the count   3 min
 *   board:home:job:<scope>:<slug>          GET /jobs/:slug, the job page's rows (expiry applied per request)   10 min
 *   board:home:company:<scope>:<slug>      GET /companies/:slug, the profile and its jobs (expiry applied per request)   10 min
 *   board:home:companies:first             GET /companies, the plain first page   3 min
 *   board:home:companies:overview          the directory's header on its other pages   3 min
 *   stats:category-counts:<all|company-N>  the categories' open-job counts   10 min
 *   seo:sitemap                            GET /jobs/sitemap          1 h
 *   board:tiers                            GET /board/tiers (/pricing/)  1 day (every admin write clears it)
 */
export const HOME_PREFIX = 'board:home:';
export const CATEGORY_COUNTS_PREFIX = 'stats:category-counts:';
export const SITEMAP_KEY = 'seo:sitemap';
export const TIERS_KEY = 'board:tiers';

/**
 * Clears the public lists after a job went live, left the board, or was featured (and the
 * pricing tiers, saved only by admin routes under `clearPublicListsAfterWrite`). Call it after
 * the write committed, outside the transaction. Never throws (a missed clear only ages to the TTL).
 */
export async function forgetPublicLists(): Promise<void> {
  await Promise.all([cache.delPrefix(HOME_PREFIX), cache.delPrefix(CATEGORY_COUNTS_PREFIX), cache.del(SITEMAP_KEY), cache.del(TIERS_KEY)]).catch(() => undefined);
}

/**
 * After any successful write under an area that can change what the public lists show (admin and
 * employer job, company and settings routes), clears them. One place instead of a call per route,
 * so a new route can't forget it; deletes are cheap and never rate limited.
 */
export const clearPublicListsAfterWrite: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.res.status < 400) await forgetPublicLists();
};
