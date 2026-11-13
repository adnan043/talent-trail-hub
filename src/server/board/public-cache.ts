import {cache} from '../../platform/cache';

/**
 * Site Cache keys of the PUBLIC job lists (docs/agent/cache.md). Each holds only what every
 * visitor sees (no viewer is read), so a shared key is safe. They change by themselves (a job
 * expires, a featured period ends), so their TTLs are short; the writes we control also clear them.
 *
 *   board:home:<any|remote|onsite|hybrid>   GET /board/home            3 min
 *   stats:category-counts:<all|company-N>  the categories' open-job counts   10 min
 *   seo:sitemap                            GET /jobs/sitemap          1 h
 */
export const HOME_PREFIX = 'board:home:';
export const CATEGORY_COUNTS_PREFIX = 'stats:category-counts:';
export const SITEMAP_KEY = 'seo:sitemap';

/**
 * Clears the public lists after a job went live, left the board, or was featured. Call it after
 * the write committed, outside the transaction. Never throws (a missed clear only ages to the TTL).
 */
export async function forgetPublicLists(): Promise<void> {
  await Promise.all([cache.delPrefix(HOME_PREFIX), cache.delPrefix(CATEGORY_COUNTS_PREFIX), cache.del(SITEMAP_KEY)]).catch(() => undefined);
}
