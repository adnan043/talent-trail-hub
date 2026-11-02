import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {EMPTY_JOB_VALUES} from '../../src/lib/job-input';
import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {runExpiry} from '../../src/server/board/tasks';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * Release 1 end to end through the real Site API: the admin opens free posting with review of
 * every post, an employer posts (hidden until approved), the admin approves, a guest applies,
 * the employer edits (back to review, dates kept), expiry takes it down, single-company mode
 * closes the employer side. The platform's file storage is faked (as in applications.test.ts).
 */
const DAY = 86_400_000;
const ADMIN = 'flow-admin@example.test';
const EMPLOYER = 'flow-employer@example.test';
const OTHER = 'flow-other@example.test';
const LIST = '/site-api/jobs?q=&category=&type=&workplace=&location=&minSalary=&posted=&sort=&featured=&before=';
const description = 'We are hiring a careful engineer to build and run our services. '.repeat(5);

const harnessFetch = globalThis.fetch;
let fileSeq = 0;
function fakeFiles() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.includes('/api/site/v1/files') ? new URL(url).pathname.replace('/api/site/v1/files', '') : null;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status});
    if (path === '/uploads') {
      const id = `file_${String(++fileSeq).padStart(26, '0')}`;
      return json(201, {data: {file: {id}, upload: {method: 'PUT', url: `/__platform/files/uploads/${id}`, headers: {}, expiresAt: ''}}});
    }
    if (path?.endsWith('/complete')) return json(200, {data: {file: {id: path.split('/')[1], status: 'ready'}}});
    // The resume first-bytes check: a short link to the file, then its first bytes (a real PDF).
    if (path?.endsWith('/url')) return json(200, {data: {url: 'https://files.example.test/x?sig=1', expiresAt: new Date().toISOString()}});
    if (url.startsWith('https://files.example.test/')) return new Response('%PDF-1.7\n', {status: 206});
    if (path && init?.method === 'DELETE') return json(200, {data: {deleted: true}});
    return harnessFetch(input, init);
  };
}

async function setRoles(email: string, ...slugs: string[]) {
  const id = await userId(email);
  const roles = await db.role.findMany({where: {slug: {in: slugs}}, select: {id: true}});
  await db.userRole.deleteMany({where: {userId: id}});
  await db.userRole.createMany({data: roles.map(role => ({userId: id, roleId: role.id}))});
}

/** The admin role holds the board's codenames (catalogue defaults; made sure of here). */
async function grantAdmin(...codenames: string[]) {
  const role = await db.role.findUniqueOrThrow({where: {slug: 'admin'}, select: {id: true}});
  for (const codename of codenames) {
    const p = await db.permission.upsert({where: {codename}, create: {codename, title: codename}, update: {}, select: {id: true}});
    await db.rolePermission.upsert({where: {roleId_permissionId: {roleId: role.id, permissionId: p.id}}, create: {roleId: role.id, permissionId: p.id}, update: {}});
  }
}

const slugs = (res: {json: Record<string, unknown>}) => (res.json.jobs as {slug: string}[]).map(j => j.slug);

describe.skipIf(!DATABASE_URL)('board flow, Release 1 end to end (integration, real Postgres)', () => {
  let admin: Browser;
  let employer: Browser;
  let other: Browser;
  const guest = () => new Browser(app, '198.51.100.40');
  let categoryId = 0;

  const jobValues = (title: string) => ({...EMPTY_JOB_VALUES, title, categoryId: String(categoryId), descriptionMd: description, tags: 'go, postgres'});
  const company = (companyName: string) => ({companyName, website: 'https://flow.example', location: 'Berlin', about: 'We build things.'});

  async function approve(jobId: number) {
    const opened = await admin.get(`/site-api/manage/moderation/${jobId}`);
    expect(opened.status).toBe(200);
    const seen = (opened.json.item as {submittedAt: string}).submittedAt;
    const res = await admin.post(`/site-api/manage/moderation/${jobId}/approve`, {seen});
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('published');
  }

  async function apply(browser: Browser, slug: string, email: string) {
    const grant = await browser.post('/site-api/applications/resume', {name: 'cv.pdf', contentType: 'application/pdf', size: 1000});
    expect(grant.status).toBe(201);
    const token = grant.json.token as string;
    expect((await browser.post('/site-api/applications/resume/complete', {token})).status).toBe(200);
    return browser.post(`/site-api/applications/jobs/${slug}/apply`, {name: 'Casey Candidate', email, consent: true, resumeToken: token});
  }

  beforeAll(async () => {
    configureEnv();
    fakeFiles();
    await resetDatabase();
    forgetBoardSettings();
    categoryId = (await db.category.upsert({where: {slug: 'engineering'}, create: {name: 'Engineering', slug: 'engineering'}, update: {isActive: true}, select: {id: true}})).id;
    admin = await signedIn(app, ADMIN, undefined, '203.0.113.60');
    employer = await signedIn(app, EMPLOYER, undefined, '203.0.113.61');
    other = await signedIn(app, OTHER, undefined, '203.0.113.62');
    await setRoles(ADMIN, 'admin');
    await setRoles(EMPLOYER, 'member');
    await setRoles(OTHER, 'member');
    await grantAdmin('site:job:manage', 'site:job:moderate', 'site:applicant:read', 'site:board:settings');
  });
  afterAll(async () => {
    globalThis.fetch = harnessFetch;
    await db.$disconnect();
  });

  it('walks post → review → approve → apply → edit → expiry → single-company', async () => {
    // (1) The admin turns free posting on, adds two free tiers, and reviews every post.
    expect((await admin.request('PUT', '/site-api/manage/tiers/free-posting', {enabled: true})).status).toBe(200);
    const tier = async (name: string, durationDays: number) => {
      const res = await admin.post('/site-api/manage/tiers', {name, priceKey: null, durationDays, includesFeatured: false, isActive: true});
      expect(res.status).toBe(201);
      return (res.json.tier as {id: number}).id;
    };
    const tier30 = await tier('Standard', 30);
    const tier60 = await tier('Long', 60);
    const mode = await admin.request('PUT', '/site-api/manage/settings/moderation', {mode: 'all'});
    expect(mode.status).toBe(200);
    expect(mode.json.mode).toBe('all');
    const options = await employer.get('/site-api/employer/options');
    expect(options.json).toMatchObject({freePosting: true, company: null});

    // (2) The employer creates their company with the first post: it waits for review, hidden.
    const posted = await employer.post('/site-api/employer/post', {job: jobValues('Backend Engineer'), company: company('Flow Robots'), tierId: tier30});
    expect(posted.status).toBe(201);
    expect(posted.json).toMatchObject({status: 'done', jobStatus: 'pending_review'});
    const jobId = posted.json.jobId as number;
    const row = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {slug: true, status: true, source: true, publishedAt: true, company: {select: {name: true, ownerUserId: true}}}});
    expect(row).toMatchObject({status: 'pending_review', source: 'free', publishedAt: null, company: {name: 'Flow Robots', ownerUserId: await userId(EMPLOYER)}});
    const slug = row.slug;
    expect(slugs(await guest().get(LIST))).not.toContain(slug);
    expect((await guest().get(`/site-api/jobs/${slug}`)).status).toBe(404);

    // The other employer posts on the 60-day tier (also into review).
    const otherPost = await other.post('/site-api/employer/post', {job: jobValues('Data Engineer'), company: company('Other Labs'), tierId: tier60});
    expect(otherPost.json).toMatchObject({status: 'done', jobStatus: 'pending_review'});
    const otherJobId = otherPost.json.jobId as number;
    const otherSlug = (await db.job.findUniqueOrThrow({where: {id: otherJobId}, select: {slug: true}})).slug;
    const queue = await admin.get('/site-api/manage/moderation');
    expect((queue.json.items as {id: number}[]).map(i => i.id)).toEqual([jobId, otherJobId]);

    // (3) Approved: public, expiring the tier's 30 days from approval.
    const t0 = Date.now();
    await approve(jobId);
    const t1 = Date.now();
    await approve(otherJobId);
    const live = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true, publishedAt: true, expiresAt: true}});
    expect(live.status).toBe('published');
    expect(live.publishedAt!.getTime()).toBeGreaterThanOrEqual(t0);
    expect(live.publishedAt!.getTime()).toBeLessThanOrEqual(t1);
    expect(live.expiresAt!.getTime() - live.publishedAt!.getTime()).toBe(30 * DAY);
    expect(slugs(await guest().get(LIST))).toEqual(expect.arrayContaining([slug, otherSlug]));
    const detail = await guest().get(`/site-api/jobs/${slug}`);
    expect(detail.status).toBe(200);
    expect((detail.json.job as {state: string}).state).toBe('active');

    // (4) A guest applies; the employer sees them, the other employer cannot, staff see all.
    const visitor = guest();
    expect((await apply(visitor, slug, 'casey@example.test')).status).toBe(201);
    const mine = await employer.get(`/site-api/applications/jobs/${jobId}/applicants?status=&before=`);
    expect(mine.status).toBe(200);
    expect((mine.json.items as {email: string}[]).map(r => r.email)).toEqual(['casey@example.test']);
    expect((await other.get(`/site-api/applications/jobs/${jobId}/applicants?status=&before=`)).status).toBe(404);
    const all = await admin.get('/site-api/applications/all?status=&before=&job=');
    expect(all.status).toBe(200);
    expect((all.json.items as {email: string; job: {company: string}}[]).map(r => [r.email, r.job.company])).toEqual([['casey@example.test', 'Flow Robots']]);
    const again = await apply(visitor, slug, 'Casey@Example.test');
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('already_applied');
    expect(await db.application.count()).toBe(1);

    // (5) Editing the live job sends it back to review; approval keeps its dates.
    const edited = await employer.request('PUT', `/site-api/employer/jobs/${jobId}`, {job: jobValues('Senior Backend Engineer')});
    expect(edited.status).toBe(200);
    expect(edited.json.reReview).toBe(true);
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true}})).status).toBe('pending_review');
    expect(slugs(await guest().get(LIST))).not.toContain(slug);
    await approve(jobId);
    const reapproved = await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true, title: true, publishedAt: true, expiresAt: true}});
    expect(reapproved).toEqual({status: 'published', title: 'Senior Backend Engineer', publishedAt: live.publishedAt, expiresAt: live.expiresAt});

    // (6) Expiry, one minute after its date: expired and off the list; the 60-day job stays.
    const result = await runExpiry(db, 'https://shop.example.test/site-api/_platform/jobs', new Date(live.expiresAt!.getTime() + 60_000));
    expect(result.summary.expired).toBe(1);
    expect((await db.job.findUniqueOrThrow({where: {id: jobId}, select: {status: true}})).status).toBe('expired');
    expect((await db.job.findUniqueOrThrow({where: {id: otherJobId}, select: {status: true}})).status).toBe('published');
    forgetBoardSettings();
    expect(slugs(await guest().get(LIST))).toEqual([otherSlug]);
    expect(((await guest().get(`/site-api/jobs/${slug}`)).json.job as {state: string}).state).toBe('expired');

    // (7) Single-company mode with the board's own company: employer API 404, only its jobs public.
    const ownerCo = await db.company.create({data: {name: 'Board Owner Inc', slug: 'board-owner-inc'}, select: {id: true}});
    const adminJob = await admin.post('/site-api/manage/jobs', {
      values: {title: 'Office Manager', categoryId: String(categoryId), employmentType: 'FULL_TIME', workplaceType: 'remote', descriptionMd: description, salaryPeriod: 'YEAR', applyMethod: 'onsite', tags: 'ops'},
      companyId: ownerCo.id,
      durationDays: 14,
    });
    expect(adminJob.status).toBe(201);
    const ownerSlug = (await db.job.findUniqueOrThrow({where: {id: adminJob.json.id as number}, select: {slug: true}})).slug;
    expect(slugs(await guest().get(LIST)).sort()).toEqual([otherSlug, ownerSlug].sort());

    const single = await admin.request('PUT', '/site-api/manage/settings/board', {mode: 'single_company', ownerCompanyId: ownerCo.id});
    expect(single.status).toBe(200);
    for (const browser of [employer, other]) {
      for (const path of ['/site-api/employer/options', '/site-api/employer/jobs', '/site-api/employer/company']) {
        expect((await browser.get(path)).status, path).toBe(404);
      }
    }
    expect((await other.post('/site-api/employer/post', {job: jobValues('Another'), tierId: tier30})).status).toBe(404);
    expect(slugs(await guest().get(LIST))).toEqual([ownerSlug]);
    expect((await guest().get(`/site-api/jobs/${otherSlug}`)).status).toBe(404);
    expect((await guest().get(`/site-api/jobs/${ownerSlug}`)).status).toBe(200);
  });
});
