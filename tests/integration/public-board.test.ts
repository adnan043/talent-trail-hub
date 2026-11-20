import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {refreshActiveJobCount} from '../../src/server/board/employer';
import {forgetPublicLists} from '../../src/server/board/public-cache';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/**
 * The public board's data integrity (workstream A): only published, unexpired jobs of unblocked
 * companies are public; expired / closed pages stay readable but flagged; the featured pin cap;
 * the view count leaves `updated_at` alone; single-company mode scopes everything (F39).
 */

const DAY = 86_400_000;
let categoryId = 0;

async function company(name: string, over: {isBlocked?: boolean} = {}) {
  return db.company.create({data: {name, slug: name.toLowerCase().replace(/\s+/g, '-'), ...over}, select: {id: true}});
}

async function job(companyId: number, slug: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  const row = await db.job.create({
    data: {
      companyId,
      categoryId,
      title: slug.replace(/-/g, ' '),
      slug,
      descriptionHtml: '<p>Work with us.</p><script>x</script>',
      descriptionMd: 'Work with us.',
      employmentType: 'FULL_TIME',
      workplaceType: 'onsite',
      status: 'published',
      publishedAt: new Date(now - DAY),
      expiresAt: new Date(now + 10 * DAY),
      ...over,
    },
    select: {id: true, updatedAt: true},
  });
  // The app keeps the directory's counter on every job write; a row made here does the same.
  await refreshActiveJobCount(db, companyId);
  return row;
}

describe.skipIf(!DATABASE_URL)('public board (integration, real Postgres)', () => {
  let browser: Browser;

  beforeAll(() => configureEnv());
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    forgetBoardSettings();
    // Job pages and first pages are kept in the Site Cache (module memory here): each test starts empty.
    await forgetPublicLists();
    categoryId = (await db.category.upsert({where: {slug: 'design'}, create: {name: 'Design', slug: 'design'}, update: {}, select: {id: true}})).id;
    browser = new Browser(app, '203.0.113.50');
  });

  it('lists only public jobs and keeps expired / closed pages without leaking drafts', async () => {
    const acme = await company('Acme');
    const bad = await company('Bad Co', {isBlocked: true});
    await job(acme.id, 'live-job');
    await job(acme.id, 'late-expiry', {expiresAt: new Date(Date.now() - 1000)});
    await job(acme.id, 'closed-job', {status: 'closed'});
    await job(acme.id, 'draft-job', {status: 'draft'});
    await job(bad.id, 'blocked-job');

    const list = await browser.get('/site-api/jobs?q=&category=&type=&workplace=&location=&minSalary=&posted=&sort=&featured=&before=');
    expect(list.status).toBe(200);
    expect((list.json.jobs as {slug: string}[]).map(j => j.slug)).toEqual(['live-job']);

    const live = await browser.get('/site-api/jobs/live-job');
    expect((live.json.job as {state: string; descriptionHtml: string}).state).toBe('active');
    expect((live.json.job as {descriptionHtml: string}).descriptionHtml).not.toContain('<script');
    expect(((await browser.get('/site-api/jobs/late-expiry')).json.job as {state: string}).state).toBe('expired');
    expect(((await browser.get('/site-api/jobs/closed-job')).json.job as {state: string}).state).toBe('closed');
    // The employer's apply address is only handed out while the job is open.
    await db.job.updateMany({where: {slug: {in: ['live-job', 'late-expiry', 'closed-job']}}, data: {applyMethod: 'email', applyTarget: 'jobs@acme.example'}});
    // A real edit goes through a route that clears the cached job pages; this one is direct.
    await forgetPublicLists();
    const target = async (slug: string) => ((await browser.get(`/site-api/jobs/${slug}`)).json.job as {applyTarget: string | null}).applyTarget;
    expect(await target('live-job')).toBe('jobs@acme.example');
    expect(await target('late-expiry')).toBeNull();
    expect(await target('closed-job')).toBeNull();
    expect((await browser.get('/site-api/jobs/draft-job')).status).toBe(404);
    expect((await browser.get('/site-api/jobs/blocked-job')).status).toBe(404);
    expect((await browser.get('/site-api/companies/bad-co')).status).toBe(404);

    const sitemap = await browser.get('/site-api/jobs/sitemap');
    expect((sitemap.json.jobs as {slug: string}[]).map(j => j.slug)).toEqual(['live-job']);
  });

  it('odd but valid-looking filters and cursors answer normally, never a 500', async () => {
    const acme = await company('Acme');
    await job(acme.id, 'live-job');
    // Names of Object's built-ins as a location: no country, not a crash.
    for (const location of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const res = await browser.get(`/site-api/jobs?location=${location}`);
      expect(res.status, location).toBe(200);
    }
    // A cursor id past the database's integer: ignored (the first page), not a 500.
    const companies = await browser.get('/site-api/companies?after=1.9999999999');
    expect(companies.status).toBe(200);
  });

  it('location: every comma part matches city, region or country; short parts match exactly', async () => {
    const acme = await company('Acme');
    const place = (city: string | null, region: string | null, country: string | null) => ({locationCity: city, locationRegion: region, locationCountry: country});
    await job(acme.id, 'berlin', place('Berlin', null, 'DE'));
    await job(acme.id, 'portland-or', place('Portland', 'OR', 'US'));
    await job(acme.id, 'portland-me', place('Portland', 'ME', 'US'));
    await job(acme.id, 'chicago', place('Chicago', 'Illinois', 'US'));
    await job(acme.id, 'dresden', place('Dresden', 'Saxony', 'DE'));
    await job(acme.id, 'remote-job', {workplaceType: 'remote'});
    const slugs = async (location: string) =>
      ((await browser.get(`/site-api/jobs?location=${encodeURIComponent(location)}`)).json.jobs as {slug: string}[]).map(j => j.slug).sort();
    expect(await slugs('Berlin, Germany')).toEqual(['berlin']);
    expect(await slugs('Portland, OR')).toEqual(['portland-or']);
    expect(await slugs('Portland, OR, United States')).toEqual(['portland-or']);
    expect(await slugs('portland, ,')).toEqual(['portland-me', 'portland-or']);
    expect(await slugs('Berlin, France')).toEqual([]);
    // A 2-letter part: the country code or an exact region / city, never a substring.
    expect(await slugs('DE')).toEqual(['berlin', 'dresden']);
    expect(await slugs('IN')).toEqual([]);
    expect(await slugs('or')).toEqual(['portland-or']);
    expect(await slugs('Remote')).toEqual(['remote-job']);
  });

  it('a typed % or _ is a plain character in the keyword and the location, not a wildcard', async () => {
    const acme = await company('Acme');
    await job(acme.id, 'plain-job', {title: 'Plain Job'});
    await job(acme.id, 'percent-job', {title: '100% Remote Writer'});
    const slugs = async (query: string) => ((await browser.get(`/site-api/jobs?${query}`)).json.jobs as {slug: string}[]).map(j => j.slug).sort();
    expect(await slugs('q=%25')).toEqual(['percent-job']);
    expect(await slugs('q=_')).toEqual([]);
    expect(await slugs('q=100%25')).toEqual(['percent-job']);
    expect(await slugs('location=%25%25%25')).toEqual([]);
  });

  it('"Highest salary" compares yearly pay, using the minimum when there is no maximum', async () => {
    const acme = await company('Acme');
    const yearly = (min: number | null, max: number | null, period: string) => ({salaryMinCents: min, salaryMaxCents: max, salaryCurrency: 'USD', salaryPeriod: period});
    await job(acme.id, 'no-salary');
    await job(acme.id, 'yearly-90k', yearly(null, 9_000_000, 'YEAR'));
    await job(acme.id, 'min-only-100k', yearly(10_000_000, null, 'YEAR'));
    await job(acme.id, 'hourly-60', yearly(4_000, 6_000, 'HOUR')); // 124,800 a year
    const monthly = await job(acme.id, 'monthly-5k', yearly(null, 500_000, 'MONTH')); // 60,000 a year
    const slugs = async (before = '') => {
      const res = await browser.get(`/site-api/jobs?sort=salary&before=${before}`);
      expect(res.status).toBe(200);
      return res;
    };
    expect(((await slugs()).json.jobs as {slug: string}[]).map(j => j.slug)).toEqual(['hourly-60', 'min-only-100k', 'yearly-90k', 'monthly-5k', 'no-salary']);
    // An edit moves the job (the trigger keeps the sort column).
    await db.job.update({where: {id: monthly.id}, data: {salaryMaxCents: 1_500_000}});
    // A real edit goes through a route that clears the cached first page; this one is direct.
    await forgetPublicLists();
    expect(((await slugs()).json.jobs as {slug: string}[])[0]!.slug).toBe('monthly-5k');
  });

  it('never serves an expired or closed job whose edit awaits review', async () => {
    const acme = await company('Acme');
    await job(acme.id, 'closed-edited', {status: 'closed', needsReview: true});
    await job(acme.id, 'closed-clean', {status: 'closed'});
    await job(acme.id, 'late-edited', {expiresAt: new Date(Date.now() - 1000), needsReview: true});
    expect((await browser.get('/site-api/jobs/closed-edited')).status).toBe(404);
    expect((await browser.get('/site-api/jobs/late-edited')).status).toBe(404);
    expect((await browser.get('/site-api/jobs/closed-clean')).status).toBe(200);
    const saved = await browser.post('/site-api/jobs/saved', {slugs: ['closed-edited', 'closed-clean']});
    expect((saved.json.jobs as {slug: string}[]).map(j => j.slug)).toEqual(['closed-clean']);
  });

  it('pins at most 5 featured jobs on page 1 and links the rest', async () => {
    const acme = await company('Acme');
    for (let i = 0; i < 7; i++) await job(acme.id, `featured-${i}`, {isFeatured: true});
    for (let i = 0; i < 3; i++) await job(acme.id, `plain-${i}`);
    const page = await browser.get('/site-api/jobs?q=&category=&type=&workplace=&location=&minSalary=&posted=&sort=&featured=&before=');
    const jobs = page.json.jobs as {slug: string; featured: boolean}[];
    expect(page.json.pinned).toBe(5);
    expect(jobs.slice(0, 5).every(j => j.featured)).toBe(true);
    expect(new Set(jobs.map(j => j.slug)).size).toBe(10);
    expect(page.json.featuredMore).toBe(true);
    // Page 1 is full (20 slots), so no next page; the cursor format carries the pin hour.
    expect(page.json.nextBefore).toBeNull();

    const featured = await browser.get('/site-api/jobs?q=&category=&type=&workplace=&location=&minSalary=&posted=&sort=&featured=1&before=');
    expect(featured.json.pinned).toBe(0);
    expect((featured.json.jobs as unknown[]).length).toBe(7);
  });

  it('a filtered search pins featured matches on page 1 and pages through the rest exactly once', async () => {
    const acme = await company('Acme');
    for (let i = 0; i < 7; i++) await job(acme.id, `designer-featured-${i}`, {isFeatured: true, publishedAt: new Date(Date.now() - (i + 1) * 60_000)});
    for (let i = 0; i < 23; i++) await job(acme.id, `designer-plain-${i}`, {publishedAt: new Date(Date.now() - (i + 10) * 60_000)});
    await job(acme.id, 'writer-other');
    const first = await browser.get('/site-api/jobs?q=designer');
    const firstJobs = first.json.jobs as {slug: string; featured: boolean}[];
    expect(first.json.pinned).toBe(5);
    expect(firstJobs).toHaveLength(20);
    expect(firstJobs.slice(0, 5).every(j => j.featured)).toBe(true);
    expect(first.json.featuredCount).toBe(7);
    const second = await browser.get(`/site-api/jobs?q=designer&before=${encodeURIComponent(first.json.nextBefore as string)}`);
    const secondJobs = second.json.jobs as {slug: string}[];
    expect(second.json.nextBefore).toBeNull();
    const all = [...firstJobs, ...secondJobs].map(j => j.slug);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(30);
    expect(all).not.toContain('writer-other');
  });

  it('a keyword search pins only the featured jobs it matches (a `%` in it is no wildcard)', async () => {
    const acme = await company('Acme');
    await job(acme.id, 'designer-featured', {isFeatured: true});
    await job(acme.id, 'writer-featured', {isFeatured: true});
    await job(acme.id, 'designer-ended', {isFeatured: true, featuredUntil: new Date(Date.now() - 60_000)});
    await job(acme.id, 'designer-plain');
    const page = await browser.get('/site-api/jobs?q=designer');
    const jobs = page.json.jobs as {slug: string; featured: boolean}[];
    expect(page.json.pinned).toBe(1);
    expect(jobs[0]!.slug).toBe('designer-featured');
    expect(jobs.map(j => j.slug).sort()).toEqual(['designer-ended', 'designer-featured', 'designer-plain']);
    // The board's featured count is the whole board's, as before.
    expect(page.json.featuredCount).toBe(2);
    const none = await browser.get(`/site-api/jobs?q=${encodeURIComponent('design%')}`);
    expect(none.json.pinned).toBe(0);
    expect(none.json.jobs).toEqual([]);
  });

  it('a cached job page still follows the clock: past its end it reads expired, without the apply address', async () => {
    const acme = await company('Acme');
    await job(acme.id, 'ending-soon', {expiresAt: new Date(Date.now() + 1500), applyMethod: 'email', applyTarget: 'jobs@acme.example'});
    const before = (await browser.get('/site-api/jobs/ending-soon')).json.job as {state: string; applyTarget: string | null};
    expect(before).toMatchObject({state: 'active', applyTarget: 'jobs@acme.example'});
    // A direct write skips the clear, so the next read shows whether it came from the cache.
    await db.job.updateMany({where: {slug: 'ending-soon'}, data: {title: 'changed directly'}});
    await new Promise(resolve => setTimeout(resolve, 1600));
    const after = (await browser.get('/site-api/jobs/ending-soon')).json.job as {title: string; state: string; applyTarget: string | null};
    expect(after).toMatchObject({title: 'ending soon', state: 'expired', applyTarget: null});
    // Once cleared (as every job route does after a write), the page is read again.
    await forgetPublicLists();
    expect(((await browser.get('/site-api/jobs/ending-soon')).json.job as {title: string}).title).toBe('changed directly');
  });

  it('a company gets a public page only once one of its jobs has been live', async () => {
    const fresh = await company('Spam Co');
    await job(fresh.id, 'spam-draft', {status: 'pending_payment', publishedAt: null, expiresAt: null});
    await job(fresh.id, 'spam-rejected', {status: 'rejected', publishedAt: null, expiresAt: null});
    expect((await browser.get('/site-api/companies/spam-co')).status).toBe(404);
    const past = await company('Past Co');
    await job(past.id, 'past-job', {status: 'expired', expiresAt: new Date(Date.now() - DAY)});
    expect((await browser.get('/site-api/companies/past-co')).status).toBe(200);
    await job(fresh.id, 'spam-live');
    expect((await browser.get('/site-api/companies/spam-co')).status).toBe(200);
  });

  it('orders the companies directory and "Hiring now" by open jobs', async () => {
    const small = await company('Small Co');
    const big = await company('Big Co');
    const blocked = await company('Gone Co', {isBlocked: true});
    await job(small.id, 'small-1');
    for (let i = 0; i < 3; i++) await job(big.id, `big-${i}`);
    for (let i = 0; i < 5; i++) await job(blocked.id, `gone-${i}`);
    const list = await browser.get('/site-api/companies?after=');
    expect((list.json.companies as {slug: string; openJobCount: number}[]).map(co => [co.slug, co.openJobCount])).toEqual([
      ['big-co', 3],
      ['small-co', 1],
    ]);
    expect(list.json.nextAfter).toBeNull();
    const home = await browser.get('/site-api/board/home?workplace=');
    expect((home.json.companies as {slug: string}[]).map(co => co.slug)).toEqual(['big-co', 'small-co']);
    const remote = await browser.get('/site-api/board/home?workplace=remote');
    expect(remote.json.latest).toEqual([]);
  });

  it('counts one view per visitor and job a day, without touching updated_at', async () => {
    const acme = await company('Acme');
    const row = await job(acme.id, 'viewed-job');
    expect((await browser.post('/site-api/jobs/viewed-job/view')).status).toBe(200);
    // The same visitor again the same day: not counted twice.
    expect((await browser.post('/site-api/jobs/viewed-job/view')).status).toBe(200);
    // A parallel burst from another visitor counts once.
    const other = new Browser(app, '203.0.113.77');
    await other.get('/site-api/auth/csrf');
    await Promise.all(Array.from({length: 4}, () => other.post('/site-api/jobs/viewed-job/view')));
    const after = await db.job.findUnique({where: {id: row.id}, select: {viewCount: true, updatedAt: true}});
    expect(after).toEqual({viewCount: 2, updatedAt: row.updatedAt});
  });

  it('single-company mode shows only the owner company and hides the marketplace', async () => {
    const owner = await company('Owner Inc');
    const other = await company('Other Co');
    await job(owner.id, 'owner-job');
    await job(other.id, 'other-job');
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, boardMode: 'single_company', ownerCompanyId: owner.id}, update: {boardMode: 'single_company', ownerCompanyId: owner.id}});
    forgetBoardSettings();

    const list = await browser.get('/site-api/jobs?q=&category=&type=&workplace=&location=&minSalary=&posted=&sort=&featured=&before=');
    expect((list.json.jobs as {slug: string}[]).map(j => j.slug)).toEqual(['owner-job']);
    expect((await browser.get('/site-api/jobs/other-job')).status).toBe(404);
    expect((await browser.get('/site-api/companies?after=')).status).toBe(404);
    expect((await browser.get('/site-api/companies/other-co')).status).toBe(404);
    expect((await browser.get('/site-api/companies/owner-inc')).status).toBe(200);
    expect((await browser.get('/site-api/board/tiers')).status).toBe(404);
    const home = await browser.get('/site-api/board/home?workplace=');
    expect((home.json.ownerCompany as {slug: string}).slug).toBe('owner-inc');
    expect(home.json.companies).toEqual([]);
    const css = await browser.get('/site-api/board/brand.css');
    expect(String(css.json.text)).toContain('[data-marketplace-only]');
  });
});
