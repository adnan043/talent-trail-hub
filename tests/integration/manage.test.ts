import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {sendBoardEmail} from '../../src/server/board/email';
import {reviewerEmails} from '../../src/server/board/review';
import {getBoardSettings} from '../../src/server/board/settings';
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
    forgetBoardSettings();
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

  it("the email log shows full addresses only to the site's owner; admins and others see them masked and cannot search by address", async () => {
    await db.emailLog.create({data: {templateKey: 'application-confirmation', to: 'casey@example.test', status: 'skipped'}});
    const role = await owner.post('/site-api/admin/roles', {slug: 'bookkeeper', name: 'Bookkeeper', permissions: ['site:board:reports']});
    expect(role.status).toBe(201);
    const keeper = await signedIn(app, 'keeper@example.test', undefined, '203.0.113.4');
    expect((await owner.request('PUT', `/site-api/admin/users/${await userId('keeper@example.test')}/roles`, {roles: ['member', 'bookkeeper']})).status).toBe(200);

    // A reports-only role and a full admin (site:user:read) alike: masked, no search by address.
    for (const viewer of [keeper, admin]) {
      const masked = await viewer.get('/site-api/manage/emails?status=&before=');
      expect(masked.status).toBe(200);
      expect((masked.json.emails as {to: string}[]).map(e => e.to)).toEqual(['c•••@example.test']);
      expect((await viewer.post('/site-api/manage/emails/search', {to: 'casey@example.test', status: '', before: ''})).status).toBe(403);
      // Filtering by status only is still fine.
      expect((await viewer.post('/site-api/manage/emails/search', {to: '', status: 'skipped', before: ''})).status).toBe(200);
    }

    const full = await owner.get('/site-api/manage/emails?status=&before=');
    expect((full.json.emails as {to: string}[]).map(e => e.to)).toEqual(['casey@example.test']);
    const found = await owner.post('/site-api/manage/emails/search', {to: 'Casey@Example.test', status: '', before: ''});
    expect(found.status).toBe(200);
    expect((found.json.emails as {to: string}[]).length).toBe(1);
    expect((await owner.post('/site-api/manage/emails/search', {to: 'nobody@example.test', status: '', before: ''})).json.emails).toEqual([]);
  });

  it("an admin edit keeps the currency the salary was entered in, after the board's currency changed", async () => {
    const {job, category} = await seedJob('admin');
    await db.job.update({where: {id: job.id}, data: {salaryMinCents: 5_000_000, salaryMaxCents: 6_000_000, salaryCurrency: 'EUR', salaryPeriod: 'YEAR'}});
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, currency: 'USD'}, update: {currency: 'USD'}});
    const detail = await admin.get(`/site-api/manage/jobs/${job.id}`);
    expect(detail.json).toMatchObject({salaryCurrency: 'EUR'});
    const saved = await admin.request('PUT', `/site-api/manage/jobs/${job.id}`, {values: {...values('Changed', category.id), salaryMin: '50000', salaryMax: '60000'}});
    expect(saved.status).toBe(200);
    expect((await db.job.findUniqueOrThrow({where: {id: job.id}, select: {salaryCurrency: true, title: true}}))).toEqual({salaryCurrency: 'EUR', title: 'Changed'});
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
    // So All jobs never offers "List again" for it.
    const listed = (await admin.get('/site-api/manage/jobs')).json.jobs as {id: number; actions: {extend: boolean}}[];
    expect(listed.find(j => j.id === job.id)!.actions.extend).toBe(false);
    // A job that was live once can be listed again.
    const live = await seedJob('admin', 'closed');
    const relisted = (await admin.get('/site-api/manage/jobs')).json.jobs as {id: number; actions: {extend: boolean}}[];
    expect(relisted.find(j => j.id === live.job.id)!.actions.extend).toBe(true);
    expect((await admin.post(`/site-api/manage/jobs/${live.job.id}/extend`, {days: 30})).status).toBe(200);
  });

  it('a job with employer changes waiting for review is never relisted unreviewed, extended or featured; stopping a feature works', async () => {
    const {job} = await seedJob('paid', 'closed');
    await db.job.update({where: {id: job.id}, data: {needsReview: true}});
    // Down with unreviewed changes: "List again" sends it to the review queue, never onto the board.
    const relist = await admin.post(`/site-api/manage/jobs/${job.id}/extend`, {days: 30});
    expect(relist.status).toBe(200);
    expect(relist.json.review).toBe(true);
    expect(await db.job.findUniqueOrThrow({where: {id: job.id}})).toMatchObject({status: 'pending_review', needsReview: true});
    await db.job.update({where: {id: job.id}, data: {status: 'published', isFeatured: true, featuredUntil: new Date(Date.now() + 86_400_000)}});
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/extend`, {days: 30})).json.error).toBe('needs_review');
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/feature`, {featured: true, days: 7})).json.error).toBe('needs_review');
    const list = await admin.get('/site-api/manage/jobs');
    expect((list.json.jobs as {id: number; needsReview: boolean}[]).find(j => j.id === job.id)?.needsReview).toBe(true);
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/feature`, {featured: false, days: null})).status).toBe(200);
    expect(await db.job.findUniqueOrThrow({where: {id: job.id}})).toMatchObject({isFeatured: false});
  });

  it('an edited live job closed by the admin while in review is not stuck: listing it again goes through review, then live', async () => {
    const {job} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {needsReview: true}});
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/close`)).status).toBe(200);
    // Its unreviewed text stays off the closed job's public page.
    expect(await db.job.findUniqueOrThrow({where: {id: job.id}})).toMatchObject({status: 'closed', needsReview: true});
    expect((await new Browser(app).get(`/site-api/jobs/${job.slug}`)).status).toBe(404);
    const relist = await admin.post(`/site-api/manage/jobs/${job.id}/extend`, {days: 20});
    expect(relist.status).toBe(200);
    expect(relist.json.review).toBe(true);
    const seen = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {item: {submittedAt: string}};
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: seen.item.submittedAt})).status).toBe(200);
    const after = await db.job.findUniqueOrThrow({where: {id: job.id}});
    expect(after).toMatchObject({status: 'published', needsReview: false});
    expect(after.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 19 * 86_400_000);
  });

  it("staff emails never go to the site owner's placeholder address (…@owner.invalid)", async () => {
    const ownerEmail = (await db.user.findFirstOrThrow({where: {platformOwnerId: {not: null}}, select: {email: true}})).email;
    expect(ownerEmail.endsWith('.invalid')).toBe(true);
    const reviewers = await reviewerEmails(db);
    expect(reviewers).toContain('admin@example.test');
    expect(reviewers.some(e => e.endsWith('.invalid'))).toBe(false);
    await sendBoardEmail(db, 'https://shop.example.test/x', {template: 'admin-job-review', to: ownerEmail, vars: {}});
    expect(await db.emailLog.count({where: {to: ownerEmail}})).toBe(0);
  });

  it('rejecting a job clears its review flag', async () => {
    const {job} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {needsReview: true}});
    const seen = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {item: {submittedAt: string}};
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/reject`, {reason: 'Not a real job.', seen: seen.item.submittedAt})).status).toBe(200);
    expect(await db.job.findUniqueOrThrow({where: {id: job.id}})).toMatchObject({status: 'rejected', needsReview: false});
  });

  it('approve and trust: the company is trusted; it can be untrusted again (site:job:moderate)', async () => {
    const {job, company} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {publishedAt: null, expiresAt: null, needsReview: true}});
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, currency: 'EUR'}, update: {currency: 'EUR'}});
    forgetBoardSettings();
    const seen = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {
      item: {submittedAt: string; company: {isTrusted: boolean; isBlocked: boolean}};
      history: {spentCents: number; spentCurrency: string};
    };
    expect(seen.item.company).toMatchObject({isTrusted: false, isBlocked: false});
    // No paid orders yet: "Spent" is in the board's currency, never a guessed USD.
    expect(seen.history).toMatchObject({spentCents: 0, spentCurrency: 'EUR'});
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: seen.item.submittedAt, trust: true})).status).toBe(200);
    expect((await db.company.findUniqueOrThrow({where: {id: company.id}})).isTrusted).toBe(true);
    expect((await member.post(`/site-api/manage/companies/${company.id}/trust`, {trusted: false})).status).toBe(403);
    expect((await admin.post(`/site-api/manage/companies/${company.id}/trust`, {trusted: 'no'})).status).toBe(422);
    const untrusted = await admin.post(`/site-api/manage/companies/${company.id}/trust`, {trusted: false});
    expect(untrusted.status).toBe(200);
    expect(untrusted.json).toMatchObject({isTrusted: false});
    expect((await db.company.findUniqueOrThrow({where: {id: company.id}})).isTrusted).toBe(false);
  });

  it('blocking a company takes its jobs off the board; unblocking brings them back; the owner company cannot be blocked', async () => {
    const {job, company} = await seedJob('paid', 'published');
    const visitor = new Browser(app);
    expect((await visitor.get(`/site-api/jobs/${job.slug}`)).status).toBe(200);
    expect((await member.post(`/site-api/manage/companies/${company.id}/block`, {blocked: true})).status).toBe(403);
    const blocked = await admin.post(`/site-api/manage/companies/${company.id}/block`, {blocked: true});
    expect(blocked.status).toBe(200);
    expect(blocked.json).toMatchObject({isBlocked: true});
    expect((await visitor.get(`/site-api/jobs/${job.slug}`)).status).toBe(404);
    const row = ((await admin.get('/site-api/manage/jobs')).json.jobs as {id: number; companyId: number; companyBlocked: boolean}[]).find(j => j.id === job.id);
    expect(row).toMatchObject({companyId: company.id, companyBlocked: true});
    expect((await admin.post(`/site-api/manage/companies/${company.id}/block`, {blocked: false})).status).toBe(200);
    expect((await visitor.get(`/site-api/jobs/${job.slug}`)).status).toBe(200);
    expect((await admin.post('/site-api/manage/companies/999999/block', {blocked: true})).status).toBe(404);
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, ownerCompanyId: company.id}, update: {ownerCompanyId: company.id}});
    const owned = await admin.post(`/site-api/manage/companies/${company.id}/block`, {blocked: true});
    expect(owned.status).toBe(409);
    expect(owned.json.error).toBe('owner_company');
  });

  it("the dashboard's numbers follow an admin write at once (the cached report is cleared)", async () => {
    const {job} = await seedJob('paid', 'pending_review');
    await db.job.update({where: {id: job.id}, data: {publishedAt: null, expiresAt: null, needsReview: true}});
    expect((await admin.get('/site-api/manage/overview')).json.pendingApprovals).toMatchObject({value: 1});
    const seen = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {item: {submittedAt: string}};
    expect((await admin.post(`/site-api/manage/moderation/${job.id}/reject`, {reason: 'Not a real job.', seen: seen.item.submittedAt})).status).toBe(200);
    expect((await admin.get('/site-api/manage/overview')).json.pendingApprovals).toMatchObject({value: 0});
  });

  it('a job in a category hidden since keeps it on an admin edit; another hidden category is refused', async () => {
    const seeded = await seedJob('admin');
    // Its own categories (categories outlive resetDatabase): the shared one stays active for other tests.
    const category = await db.category.create({data: {name: 'Hidden since', slug: `hidden-since-${Date.now()}`}});
    const job = await db.job.update({where: {id: seeded.job.id}, data: {categoryId: category.id}});
    const other = await db.category.create({data: {name: 'Old hidden', slug: `old-hidden-${Date.now()}`, isActive: false}});
    await db.category.update({where: {id: category.id}, data: {isActive: false}});
    const options = (await admin.get('/site-api/manage/jobs/form-options')).json.categories as {id: number; active: boolean}[];
    expect(options).toEqual(expect.arrayContaining([expect.objectContaining({id: category.id, active: false}), expect.objectContaining({id: other.id, active: false})]));
    expect((await admin.request('PUT', `/site-api/manage/jobs/${job.id}`, {values: values('Kept category', category.id)})).status).toBe(200);
    const moved = await admin.request('PUT', `/site-api/manage/jobs/${job.id}`, {values: values('Moved', other.id)});
    expect(moved.status).toBe(422);
    expect((await db.job.findUniqueOrThrow({where: {id: job.id}})).title).toBe('Kept category');
    // The list's category filter finds jobs in a hidden category.
    const filtered = await admin.get(`/site-api/manage/jobs?category=${category.id}`);
    expect((filtered.json.jobs as {id: number}[]).map(j => j.id)).toEqual([job.id]);
  });

  it('the queue lists flagged jobs first; a reject reason needs 3 characters', async () => {
    const a = await seedJob('paid', 'pending_review');
    const b = await seedJob('free', 'pending_review');
    await db.job.update({where: {id: b.job.id}, data: {flagged: true}});
    const queue = await admin.get('/site-api/manage/moderation');
    expect((queue.json.items as {id: number}[]).map(i => i.id)).toEqual([b.job.id, a.job.id]);
    const seen = (await admin.get(`/site-api/manage/moderation/${a.job.id}`)).json as {item: {submittedAt: string}};
    expect((await admin.post(`/site-api/manage/moderation/${a.job.id}/reject`, {reason: 'no', seen: seen.item.submittedAt})).status).toBe(422);
    expect((await admin.post(`/site-api/manage/moderation/${a.job.id}/reject`, {reason: 'Not a real job.'})).status).toBe(422);
    // The employer edits the job after the moderator opened it: rejecting what they never saw is refused.
    await db.job.update({where: {id: a.job.id}, data: {title: 'Edited after review opened'}});
    const stale = await admin.post(`/site-api/manage/moderation/${a.job.id}/reject`, {reason: 'Not a real job.', seen: seen.item.submittedAt});
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe('job_changed');
    expect((await db.job.findUniqueOrThrow({where: {id: a.job.id}})).status).toBe('pending_review');
    const fresh = (await admin.get(`/site-api/manage/moderation/${a.job.id}`)).json as {item: {submittedAt: string}};
    expect((await admin.post(`/site-api/manage/moderation/${a.job.id}/reject`, {reason: 'Not a real job.', seen: fresh.item.submittedAt})).status).toBe(200);
  });

  it('single-company mode can create its owner company', async () => {
    const res = await admin.request('PUT', '/site-api/manage/settings/board', {mode: 'single_company', newCompanyName: 'Board Owner Inc'});
    expect(res.status).toBe(200);
    expect((res.json.ownerCompany as {name: string}).name).toBe('Board Owner Inc');
    expect((await admin.request('PUT', '/site-api/manage/settings/currency', {currency: 'eu'})).status).toBe(422);
    expect((await admin.request('PUT', '/site-api/manage/settings/currency', {currency: 'eur'})).json.currency).toBe('EUR');
  });

  it('first reads of the board settings at once, on a database without the row, all succeed', async () => {
    await db.boardSettings.deleteMany();
    forgetBoardSettings();
    const reads = await Promise.all(Array.from({length: 6}, () => getBoardSettings(db as never)));
    expect(new Set(reads.map(s => s.name)).size).toBe(1);
    expect(await db.boardSettings.count()).toBe(1);
    // An admin save on a database without the row creates it too.
    await db.boardSettings.deleteMany();
    forgetBoardSettings();
    expect((await admin.request('PUT', '/site-api/manage/settings/currency', {currency: 'eur'})).status).toBe(200);
    expect(await db.boardSettings.findUniqueOrThrow({where: {id: 1}, select: {currency: true}})).toEqual({currency: 'EUR'});
  });

  it('deleting a job removes its applications', async () => {
    const {job} = await seedJob('admin');
    await db.application.create({data: {jobId: job.id, name: 'Sam', email: 'sam@example.test', consentAt: new Date(), consentText: 'ok'}});
    expect((await member.delete(`/site-api/manage/jobs/${job.id}`)).status).toBe(403);
    expect((await admin.delete(`/site-api/manage/jobs/${job.id}`)).status).toBe(200);
    expect(await db.job.count({where: {id: job.id}})).toBe(0);
    expect(await db.application.count()).toBe(0);
  });

  it('approving an edit of a job whose period ran out in review lists it as expired, never a new free period', async () => {
    const {job, company} = await seedJob('paid', 'pending_review');
    await db.company.update({where: {id: company.id}, data: {ownerUserId: await userId('member@example.test')}});
    const ended = new Date(Date.now() - 86_400_000);
    await db.job.update({where: {id: job.id}, data: {needsReview: true, expiresAt: ended, listingFeatured: true, isFeatured: false, featuredUntil: null}});
    const seen = (await admin.get(`/site-api/manage/moderation/${job.id}`)).json as {item: {submittedAt: string; liveUntil: string | null; periodEnded: boolean}};
    // The queue and the review page say what approving does: not "New", not "Edit of a live job".
    expect(seen.item).toMatchObject({liveUntil: null, periodEnded: true});
    const queue = (await admin.get('/site-api/manage/moderation')).json as {items: {id: number; periodEnded: boolean}[]};
    expect(queue.items.find(item => item.id === job.id)?.periodEnded).toBe(true);
    const res = await admin.post(`/site-api/manage/moderation/${job.id}/approve`, {seen: seen.item.submittedAt});
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('expired');
    const after = await db.job.findUniqueOrThrow({where: {id: job.id}});
    expect(after).toMatchObject({status: 'expired', needsReview: false, isFeatured: false});
    expect(after.expiresAt?.getTime()).toBe(ended.getTime());
    // The employer hears it: approved, but off the board until renewed.
    expect(await db.emailLog.findMany({where: {templateKey: {in: ['job-approved', 'job-approved-expired']}}, select: {templateKey: true, to: true}})).toEqual([
      {templateKey: 'job-approved-expired', to: 'member@example.test'},
    ]);
  });

  it('extend and feature never act on a job whose edit went into review after the admin read it', async () => {
    const {job} = await seedJob('admin', 'published');
    // The employer's edit lands between the read and the write: the write's own condition refuses it.
    await db.job.update({where: {id: job.id}, data: {needsReview: true}});
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/extend`, {days: 7})).status).toBe(409);
    expect((await admin.post(`/site-api/manage/jobs/${job.id}/feature`, {featured: true, days: 7})).status).toBe(409);
    expect(await db.job.findUniqueOrThrow({where: {id: job.id}})).toMatchObject({isFeatured: false});
  });

  it('a privacy lookup leaves an audit trace (the address only as a hash)', async () => {
    const res = await admin.post('/site-api/manage/privacy/lookup', {email: 'someone@example.test'});
    expect(res.status).toBe(200);
    const events = await db.auditEvent.findMany({where: {action: 'privacy_email_lookup'}});
    expect(events).toHaveLength(1);
    expect(JSON.stringify({...events[0], id: String(events[0]!.id)})).not.toContain('someone@example.test');
  });

  it('a report range named like an Object built-in answers the default range, not a 500', async () => {
    for (const range of ['toString', 'constructor', '__proto__']) {
      expect((await admin.get(`/site-api/manage/overview/activity?range=${range}`)).status, range).toBe(200);
    }
  });
});
