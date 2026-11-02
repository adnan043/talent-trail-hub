import type {APIRoute} from 'astro';

import {absoluteUrl, xmlEscape as escape} from '../lib/seo';
import type {SitemapResponse} from '../lib/types-public';
import {backend, read} from '../server/backend';

/**
 * `/sitemap.xml` (F34), rendered ON REQUEST and cached for an hour: the public pages in
 * `src/pages/` (found automatically), the open jobs and the companies hiring
 * (`GET /site-api/jobs/sitemap`: published, unexpired, company not blocked). Expired jobs drop out.
 * A single-company board (F39) leaves out the companies, pricing and post-a-job pages.
 *
 * Never listed: sign-in pages, the dashboard, the API, the error pages, `noindex` pages (EXCLUDE),
 * `?featured=1` and filtered searches.
 */
export const prerender = false;

const EXCLUDE = new Set(['/404/', '/500/', '/checkout/', '/thanks/', '/saved/', '/signup/']);
const MARKETPLACE = new Set(['/companies/', '/pricing/', '/post-a-job/']);
const PRIVATE = /^\/(account|portal|dashboard|site-api)(\/|$)/;

/** `./about.astro` → `/about/`, `./jobs/index.astro` → `/jobs/` (every page URL ends with `/`). */
const pagePaths = Object.keys(import.meta.glob('./**/*.astro'))
  .filter(file => !file.includes('['))
  .map(file => `/${file.slice(2).replace(/\.astro$/, '').replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/'))
  .filter(path => !PRIVATE.test(path) && !EXCLUDE.has(path))
  .sort();

export const GET: APIRoute = async ({request}) => {
  const data = await read<SitemapResponse>(backend(request).jobs.sitemap.$get());
  const marketplace = data?.marketplace ?? true;
  const entries: {path: string; lastmod?: string}[] = [
    ...pagePaths.filter(path => marketplace || !MARKETPLACE.has(path)).map(path => ({path})),
    ...(data?.jobs ?? []).map(job => ({path: `/jobs/${encodeURIComponent(job.slug)}/`, lastmod: job.updatedAt})),
    ...(data?.companies ?? []).map(co => ({path: `/companies/${encodeURIComponent(co.slug)}/`, lastmod: co.updatedAt})),
  ];
  const urls = entries.flatMap(({path, lastmod}) => {
    const loc = absoluteUrl(path);
    return loc ? [`  <url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`] : [];
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // The same for everyone (no cookies read). Without the jobs (an outage) only a few minutes.
      'Cache-Control': data ? 'public, max-age=3600' : 'public, max-age=300',
    },
  });
};
