import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {Browser, configureEnv, DATABASE_URL, db, ownerSignedIn, resetDatabase, signedIn, userId} from './support/harness';

/** The board's admin (`/site-api/manage/*`): codename gating, the employer edit lock, tier rules, board mode. */
describe.skipIf(!DATABASE_URL)('manage (integration, real Postgres)', () => {
  let owner: Browser;
  let admin: Browser;
  let member: Browser;
  const harnessFetch = globalThis.fetch;

  const DESCRIPTION = 'We are looking for a careful engineer to build and run our job board. '.repeat(5);
  const values = (title: string, categoryId: number) => ({
    title,
    categoryId: String(categoryId),
    employmentType: 'FULL_TIME',
    workplaceType: 'remote',
    descriptionMd: DESCRIPTION,
    salaryPeriod: 'YEAR',
    applyMethod: 'onsite',
    tags: 'go, sql',
  });

  async function seedJob(source: string, status = 'published') {
    const category = await db.category.upsert({where: {slug: 'engineering'}, create: {name: 'Engineering', slug: 'engineering'}, update: {}});
    const company = await db.company.create({data: {name: `Acme ${source}`, slug: `acme-${source}-${Date.now()}`}});
    const job = await db.job.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        title: 'Backend engineer',
        slug: `backend-${source}-${Date.now()}`,
        descriptionHtml: '<p>x</p>',
        descriptionMd: DESCRIPTION,
        employmentType: 'FULL_TIME',
        workplaceType: 'remote',
        status,
        source,
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 86_400_000),
      },
    });
    return {job, company, category};
  }

  beforeAll(() => {
    configureEnv();
    // The platform's price catalogue: two one-time prices.
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/site/v1/payments')) {
        const price = (key: string, amountCents: number) => ({key, name: key, description: null, amountCents, currency: 'USD', interval: 'one_time', intervalCount: 1, trialDays: 0});
        return new Response(JSON.stringify({data: {mode: 'test', ready: true, prices: [price('listing-a', 9900), price('listing-b', 19900)]}}), {status: 200});
      }
      return harnessFetch(input, init);
    };
  });
  afterAll(async () => {
    globalThis.fetch = harnessFetch;
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    owner = await ownerSignedIn(app, undefined, '203.0.113.1');
    admin = await signedIn(app, 'admin@example.test', undefined, '203.0.113.2');
    member = await signedIn(app, 'member@example.test', undefined, '203.0.113.3');
    const made = await owner.request('PUT', `/site-api/admin/users/${await userId('admin@example.test')}/roles`, {roles: ['member', 'admin']});
    expect(made.status).toBe(200);
  });

  it('every admin route is gated by its codename: a member gets 403, an admin gets in', async () => {
    const reads = ['/site-api/manage/overview', '/site-api/manage/moderation', '/site-api/manage/jobs', '/site-api/manage/tiers', '/site-api/manage/emails', '/site-api/manage/settings/branding', '/site-api/manage/settings/board', '/site-api/manage/settings/moderation'];
    for (const path of reads) {
      expect((await member.get(path)).status, path).toBe(403);
      expect((await admin.get(path)).status, path).toBe(200);
    }
    expect((await new Browser(app).get('/site-api/manage/jobs')).status).toBe(401);
    expect((await member.post('/site-api/manage/privacy/lookup', {email: 'someone@example.test'})).status).toBe(403);
    expect((await member.post('/site-api/manage/jobs/run-expiry')).status).toBe(403);
    expect((await member.request('PUT', '/site-api/manage/settings/moderation', {mode: 'auto'})).status).toBe(403);
    expect((await admin.post('/site-api/manage/privacy/lookup', {email: 'someone@example.test'})).status).toBe(200);
  });

  it("an admin cannot edit an employer's job (403 employer_job_locked), but edits admin jobs", async () => {
    const paid = await seedJob('paid');
    const locked = await admin.request('PUT', `/site-api/manage/jobs/${paid.job.id}`, {values: values('Changed', paid.category.id)});
    expect(locked.status).toBe(403);
    expect(locked.json.error).toBe('employer_job_locked');
    expect((await db.job.findUniqueOrThrow({where: {id: paid.job.id}})).title).toBe('Backend engineer');

    const created = await admin.post('/site-api/manage/jobs', {values: values('Data engineer', paid.category.id), companyId: paid.company.id, durationDays: 14});
    expect(created.status).toBe(201);
    const id = created.json.id as number;
    const job = await db.job.findUniqueOrThrow({where: {id}});
    expect(job).toMatchObject({source: 'admin', status: 'published', durationDays: 14});
    const edited = await admin.request('PUT', `/site-api/manage/jobs/${id}`, {values: values('Senior data engineer', paid.category.id)});
    expect(edited.status).toBe(200);
    expect((await db.job.findUniqueOrThrow({where: {id}})).title).toBe('Senior data engineer');
    expect(await db.auditEvent.count({where: {action: 'job_edited'}})).toBe(1);
  });

  it('listing tiers: the price comes from the catalogue, 1 to 3 active, never none', async () => {
    const tier = (name: string, priceKey: string | null, isActive = true) => ({name, priceKey, durationDays: 30, includesFeatured: false, isActive});
    const unknown = await admin.post('/site-api/manage/tiers', tier('Ghost', 'no-such-price'));
    expect(unknown.status).toBe(422);
    expect(unknown.json.fields).toHaveProperty('priceKey');
    // No key while free posting is off: refused.
    expect((await admin.post('/site-api/manage/tiers', tier('Free', null))).status).toBe(422);

    const ids: number[] = [];
    for (const name of ['One', 'Two', 'Three']) {
      const res = await admin.post('/site-api/manage/tiers', tier(name, 'listing-b'));
      expect(res.status).toBe(201);
      ids.push((res.json.tier as {id: number}).id);
    }
    expect(await db.listingTier.findUniqueOrThrow({where: {id: ids[0]}})).toMatchObject({priceCents: 19900, currency: 'USD'});
    const fourth = await admin.post('/site-api/manage/tiers', tier('Four', 'listing-a'));
    expect(fourth.status).toBe(422);
    expect(await db.listingTier.count()).toBe(3);

    expect((await admin.request('PUT', `/site-api/manage/tiers/${ids[0]}`, tier('One', 'listing-a', false))).status).toBe(200);
    expect((await admin.request('PUT', `/site-api/manage/tiers/${ids[1]}`, tier('Two', 'listing-b', false))).status).toBe(200);
    const last = await admin.request('PUT', `/site-api/manage/tiers/${ids[2]}`, tier('Three', 'listing-b', false));
    expect(last.status).toBe(422);
    expect(await db.listingTier.count({where: {isActive: true}})).toBe(1);
    expect(await db.listingTier.count()).toBe(3);
  });

  it('single-company mode needs an owner company', async () => {
    const missing = await admin.request('PUT', '/site-api/manage/settings/board', {mode: 'single_company'});
    expect(missing.status).toBe(422);
    expect(missing.json.fields).toHaveProperty('ownerCompanyId');
    expect((await admin.request('PUT', '/site-api/manage/settings/board', {mode: 'single_company', ownerCompanyId: 999})).status).toBe(422);
    expect((await db.boardSettings.findUnique({where: {id: 1}}))?.boardMode ?? 'marketplace').toBe('marketplace');

    const {company} = await seedJob('admin');
    const ok = await admin.request('PUT', '/site-api/manage/settings/board', {mode: 'single_company', ownerCompanyId: company.id});
    expect(ok.status).toBe(200);
    expect((await member.get('/site-api/me')).json.board).toEqual({singleCompany: true});
    expect(await db.auditEvent.count({where: {action: 'board_mode_changed'}})).toBe(1);
  });

  it('moderation: reject needs a reason; approve publishes once', async () => {
    const {job} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {publishedAt: null, expiresAt: null, needsReview: true}});
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/reject`, {reason: ' '})).status).toBe(422);
    const seen = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {item: {submittedAt: string}};
    expect((await member.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: seen.item.submittedAt})).status).toBe(403);
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: seen.item.submittedAt})).status).toBe(200);
    expect(await db.job.findUniqueOrThrow({where: {id: job.id}})).toMatchObject({status: 'published', needsReview: false});
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: seen.item.submittedAt})).status).toBe(409);
  });

  it('approve refuses a job the employer changed after the moderator opened it', async () => {
    const {job} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {publishedAt: null, expiresAt: null}});
    const opened = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {item: {submittedAt: string}};
    // The employer edits it meanwhile (still in review).
    await new Promise(resolve => setTimeout(resolve, 5));
    await db.job.update({where: {id: job.id}, data: {title: 'Something else entirely'}});
    const stale = await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: opened.item.submittedAt});
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe('job_changed');
    expect((await db.job.findUniqueOrThrow({where: {id: job.id}})).status).toBe('pending_review');
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {})).status).toBe(422);
  });

  it('a job closed while in review, never approved, cannot be listed again from All jobs', async () => {
    const {job} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {publishedAt: null, expiresAt: null}});
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/close`)).status).toBe(200);
    const relist = await admin.post(`/site-api/manage/jobs/${job.id}/extend`, {days: 30});
    expect(relist.status).toBe(409);
    expect(relist.json.error).toBe('never_published');
    expect((await db.job.findUniqueOrThrow({where: {id: job.id}})).status).toBe('closed');
    // A job that was live once can be listed again.
    const live = await seedJob('admin', 'closed');
    expect((await admin.post(`/site-api/manage/jobs/${live.job.id}/extend`, {days: 30})).status).toBe(200);
  });

  it('a job with employer changes waiting for review cannot be relisted, extended or featured', async () => {
    const {job} = await seedJob('paid', 'closed');
    await db.job.update({where: {id: job.id}, data: {needsReview: true}});
    const relist = await admin.post(`/site-api/manage/jobs/${job.id}/extend`, {days: 30});
    expect(relist.status).toBe(409);
    expect(relist.json.error).toBe('needs_review');
    await db.job.update({where: {id: job.id}, data: {status: 'published'}});
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/feature`, {featured: true, days: 7})).json.error).toBe('needs_review');
    const list = await admin.get('/site-api/manage/jobs');
    expect((list.json.jobs as {id: number; needsReview: boolean}[]).find(j => j.id === job.id)?.needsReview).toBe(true);
  });

  it('the queue lists flagged jobs first; a reject reason needs 3 characters', async () => {
    const a = await seedJob('paid', 'pending_review');
    const b = await seedJob('free', 'pending_review');
    await db.job.update({where: {id: b.job.id}, data: {flagged: true}});
    const queue = await admin.get('/site-api/manage/moderation');
    expect((queue.json.items as {id: number}[]).map(i => i.id)).toEqual([b.job.id, a.job.id]);
    expect((await admin.post(`/site-api/manage/moderation/${a.job.id}/reject`, {reason: 'no'})).status).toBe(422);
    expect((await admin.post(`/site-api/manage/moderation/${a.job.id}/reject`, {reason: 'Not a real job.'})).status).toBe(200);
  });

  it('single-company mode can create its owner company', async () => {
    const res = await admin.request('PUT', '/site-api/manage/settings/board', {mode: 'single_company', newCompanyName: 'Board Owner Inc'});
    expect(res.status).toBe(200);
    expect((res.json.ownerCompany as {name: string}).name).toBe('Board Owner Inc');
    expect((await admin.request('PUT', '/site-api/manage/settings/currency', {currency: 'eu'})).status).toBe(422);
    expect((await admin.request('PUT', '/site-api/manage/settings/currency', {currency: 'eur'})).json.currency).toBe('EUR');
  });

  it('deleting a job removes its applications', async () => {
    const {job} = await seedJob('admin');
    await db.application.create({data: {jobId: job.id, name: 'Sam', email: 'sam@example.test', consentAt: new Date(), consentText: 'ok'}});
    expect((await member.delete(`/site-api/manage/jobs/${job.id}`)).status).toBe(403);
    expect((await admin.delete(`/site-api/manage/jobs/${job.id}`)).status).toBe(200);
    expect(await db.job.count({where: {id: job.id}})).toBe(0);
    expect(await db.application.count()).toBe(0);
  });
});
