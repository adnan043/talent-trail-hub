import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {forgetHiringRanking} from '../../src/server/routes/companies';
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
  return db.job.create({
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
    forgetHiringRanking();
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
    expect((await browser.get('/site-api/jobs/draft-job')).status).toBe(404);
    expect((await browser.get('/site-api/jobs/blocked-job')).status).toBe(404);
    expect((await browser.get('/site-api/companies/bad-co')).status).toBe(404);

    const sitemap = await browser.get('/site-api/jobs/sitemap');
    expect((sitemap.json.jobs as {slug: string}[]).map(j => j.slug)).toEqual(['live-job']);
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
