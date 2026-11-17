import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * The job seeker paths the performance checks changed: the apply is one statement (it must still
 * save and count once when two arrive together), and the own photo's versioned redirect may be kept
 * by the browser for 4 minutes while every other answer stays `no-store`.
 */
const PHOTO = `file_${'p'.repeat(26)}`;
const CV = `file_${'c'.repeat(26)}`;
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.includes('/api/site/v1/files') ? new URL(url).pathname.replace('/api/site/v1/files', '') : null;
  if (path?.endsWith('/url')) {
    return new Response(JSON.stringify({data: {url: `https://files.example.test${path}?sig=1`, expiresAt: new Date().toISOString()}}), {status: 200});
  }
  return harnessFetch(input, init);
};

describe.skipIf(!DATABASE_URL)('applicant performance paths (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    forgetBoardSettings();
  });

  async function seeker(email: string, ip: string) {
    const browser = await signedIn(app, email, undefined, ip);
    await db.applicantProfile.create({data: {userId: await userId(email), photoFileId: PHOTO, resumeFileId: CV, resumeFileName: 'cv.pdf'}});
    return browser;
  }

  it('two applies at once from one account: one is saved and counted, the other is a 409', async () => {
    await signedIn(app, 'owner@example.test', undefined, '203.0.113.40');
    const company = await db.company.create({data: {name: 'P Co', slug: 'p-co', ownerUserId: await userId('owner@example.test')}, select: {id: true}});
    const category = await db.category.upsert({where: {slug: 'perf'}, create: {name: 'Perf', slug: 'perf'}, update: {}, select: {id: true}});
    const job = await db.job.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        title: 'Job',
        slug: 'perf-job',
        descriptionHtml: '<p>x</p>',
        descriptionMd: 'x',
        employmentType: 'FULL_TIME',
        workplaceType: 'remote',
        status: 'published',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
      select: {id: true, slug: true},
    });
    const quick = await seeker('quick@example.test', '198.51.100.41');
    const apply = () => quick.post(`/site-api/applications/jobs/${job.slug}/apply`, {consent: true});
    // The board settings row first (a fresh database makes it on the first read).
    expect((await quick.get(`/site-api/applications/jobs/${job.slug}/can-apply`)).json).toMatchObject({canApply: true});
    const answers = await Promise.all([apply(), apply()]);
    expect(answers.map(a => a.status).sort()).toEqual([201, 409]);
    const rows = await db.application.findMany({where: {jobId: job.id}, select: {resumeFileId: true, resumeFileName: true, status: true}});
    expect(rows).toEqual([{resumeFileId: CV, resumeFileName: 'cv.pdf', status: 'new'}]);
    expect((await db.job.findUniqueOrThrow({where: {id: job.id}, select: {applicationCount: true}})).applicationCount).toBe(1);
  });

  it('the own photo redirect is cacheable for 4 minutes only with the current ?v=; the rest stays no-store', async () => {
    const me = await seeker('photo@example.test', '198.51.100.42');
    const versioned = await me.get(`/site-api/applicant-profile/photo?v=${PHOTO.slice(-8)}`);
    expect(versioned.status).toBe(302);
    expect(versioned.headers.get('cache-control')).toBe('private, max-age=240');
    const stale = await me.get('/site-api/applicant-profile/photo?v=00000000');
    expect(stale.status).toBe(302);
    expect(stale.headers.get('cache-control')).toBe('private, no-store');
    expect((await me.get('/site-api/applicant-profile/resume')).headers.get('cache-control')).toBe('private, no-store');
    expect((await me.get('/site-api/applicant-profile')).headers.get('cache-control')).toBe('private, no-store');
  });
});
