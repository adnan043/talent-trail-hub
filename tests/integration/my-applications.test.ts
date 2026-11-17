import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {Browser, configureEnv, DATABASE_URL, db, ownerSignedIn, resetDatabase, signedIn} from './support/harness';

/**
 * `GET /site-api/my-applications`: a signed-in candidate sees ONLY the applications sent with
 * their own confirmed email, never anyone else's, and never the employer's private notes.
 */
const CASEY = 'casey@example.test';
const DANA = 'dana@example.test';

async function makeJob(companyId: number, categoryId: number, slug: string, status = 'published') {
  return db.job.create({
    data: {
      companyId,
      categoryId,
      title: `Job ${slug}`,
      slug,
      descriptionHtml: '<p>x</p>',
      descriptionMd: 'x',
      employmentType: 'FULL_TIME',
      workplaceType: 'remote',
      status,
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    select: {id: true},
  });
}

const application = (jobId: number, email: string, extra: Record<string, unknown> = {}) => ({
  jobId,
  email,
  name: email.split('@')[0]!,
  consentAt: new Date(),
  consentText: 'I agree.',
  ...extra,
});

describe.skipIf(!DATABASE_URL)('my applications (integration, real Postgres)', () => {
  let casey: Browser;
  let dana: Browser;
  let caseyIds: number[];

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    forgetBoardSettings();
    casey = await signedIn(app, CASEY, undefined, '203.0.113.41');
    dana = await signedIn(app, DANA, undefined, '203.0.113.42');
    const company = await db.company.create({data: {name: 'Acme', slug: 'acme'}, select: {id: true}});
    const category = await db.category.upsert({where: {slug: 'mine-test'}, create: {name: 'Mine test', slug: 'mine-test'}, update: {}, select: {id: true}});
    const open = await makeJob(company.id, category.id, 'open-job');
    const closed = await makeJob(company.id, category.id, 'closed-job', 'closed');
    const a = await db.application.create({
      data: application(open.id, CASEY, {status: 'shortlisted', employerNotes: 'SECRET NOTE', coverNote: 'Hello'}),
      select: {id: true},
    });
    const b = await db.application.create({data: application(closed.id, CASEY, {status: 'rejected'}), select: {id: true}});
    await db.application.create({data: application(open.id, DANA), select: {id: true}});
    caseyIds = [b.id, a.id];
  });

  it('lists only the signed-in user’s own applications, newest first, without private notes', async () => {
    const res = await casey.get('/site-api/my-applications');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const items = res.json.items as {id: number; status: string; job: {slug: string | null; company: string}}[];
    expect(items.map(i => i.id)).toEqual(caseyIds);
    expect(items[0]!.status).toBe('rejected');
    // A closed job's page is gone: no link to it.
    expect(items[0]!.job.slug).toBeNull();
    expect(items[1]!.job).toEqual({title: 'Job open-job', company: 'Acme', slug: 'open-job'});
    expect(JSON.stringify(res.json)).not.toContain('SECRET NOTE');
    expect(JSON.stringify(res.json)).not.toContain('notes');
    expect(JSON.stringify(res.json)).not.toContain(DANA);
  });

  it('another user sees only theirs, and a stranger ?email= is ignored', async () => {
    const res = await dana.get(`/site-api/my-applications?email=${encodeURIComponent(CASEY)}`);
    expect(res.status).toBe(200);
    const items = res.json.items as {id: number}[];
    expect(items).toHaveLength(1);
    expect(items.some(i => caseyIds.includes(i.id))).toBe(false);
  });

  it('pages with ?before=', async () => {
    const res = await casey.get(`/site-api/my-applications?before=${caseyIds[0]}`);
    expect((res.json.items as {id: number}[]).map(i => i.id)).toEqual([caseyIds[1]]);
    expect(res.json.nextBefore).toBeNull();
  });

  it('filters by status, keyword and date, and counts every status over all of them', async () => {
    const first = await casey.get('/site-api/my-applications');
    expect(first.json.counts).toEqual({new: 0, reviewed: 0, shortlisted: 1, approved: 0, rejected: 1});
    const byStatus = await casey.get('/site-api/my-applications?status=rejected');
    expect((byStatus.json.items as {id: number}[]).map(i => i.id)).toEqual([caseyIds[0]]);
    // The tiles never change with the filter.
    expect(byStatus.json.counts).toEqual(first.json.counts);
    const byWord = await casey.get('/site-api/my-applications?q=OPEN-job');
    expect((byWord.json.items as {id: number}[]).map(i => i.id)).toEqual([caseyIds[1]]);
    const byCompany = await casey.get('/site-api/my-applications?q=acme');
    expect(byCompany.json.items).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    expect((await casey.get(`/site-api/my-applications?from=${today}&to=${today}`)).json.items).toHaveLength(2);
    expect((await casey.get('/site-api/my-applications?to=2000-01-01')).json.items).toHaveLength(0);
    // A bad value is no filter, never a 500; and the filters never reach another person's rows.
    expect((await casey.get('/site-api/my-applications?status=hired&from=2026-13-45')).json.items).toHaveLength(2);
    expect((await dana.get('/site-api/my-applications?q=acme')).json.items).toHaveLength(1);
    // `%` and `_` are plain characters, not wildcards matching every application.
    expect((await casey.get('/site-api/my-applications?q=%25')).json.items).toHaveLength(0);
    expect((await casey.get('/site-api/my-applications?q=_')).json.items).toHaveLength(0);
  });

  it('date filters use the browser\'s days (?tz=): an application at 02:00 in Dhaka is on that Dhaka day', async () => {
    // 2026-03-10 20:00 UTC is 2026-03-11 02:00 in Dhaka (UTC+6, getTimezoneOffset() = -360).
    await db.application.update({where: {id: caseyIds[0]!}, data: {createdAt: new Date('2026-03-10T20:00:00Z')}});
    const ids = async (query: string) => ((await casey.get(`/site-api/my-applications?${query}`)).json.items as {id: number}[]).map(i => i.id);
    expect(await ids('from=2026-03-11&to=2026-03-11&tz=-360')).toEqual([caseyIds[0]]);
    expect(await ids('from=2026-03-10&to=2026-03-10&tz=-360')).toEqual([]);
    // Without tz (or a nonsense one): UTC days, as before.
    expect(await ids('from=2026-03-10&to=2026-03-10')).toEqual([caseyIds[0]]);
    expect(await ids('from=2026-03-10&to=2026-03-10&tz=99999')).toEqual([caseyIds[0]]);
    // West of UTC (New York, +300): 2026-03-10 20:00 UTC is 15:00 on the 10th there.
    expect(await ids('from=2026-03-10&to=2026-03-10&tz=300')).toEqual([caseyIds[0]]);
  });

  it('refuses a signed-out visitor', async () => {
    const res = await new Browser(app, '198.51.100.40').get('/site-api/my-applications');
    expect(res.status).toBe(401);
  });

  it('the owner (no email here) gets an empty list', async () => {
    const owner = await ownerSignedIn(app);
    const res = await owner.get('/site-api/my-applications');
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([]);
  });
  it('follows the account, not the address: applications sent before an email change stay listed', async () => {
    const caseyUser = await db.user.findUniqueOrThrow({where: {email: CASEY}, select: {id: true}});
    const danaUser = await db.user.findUniqueOrThrow({where: {email: DANA}, select: {id: true}});
    const category = await db.category.findUniqueOrThrow({where: {slug: 'mine-test'}, select: {id: true}});
    const company = await db.company.findFirstOrThrow({select: {id: true}});
    const other = await makeJob(company.id, category.id, 'other-job');
    // Sent from Casey's account under the address it had before.
    const old = await db.application.create({data: application(other.id, 'casey-old@example.test', {applicantUserId: caseyUser.id}), select: {id: true}});
    // Sent with Casey's CURRENT address but from another account (the address used to be theirs): not Casey's.
    const third = await makeJob(company.id, category.id, 'third-job');
    const notMine = await db.application.create({data: application(third.id, CASEY, {applicantUserId: danaUser.id}), select: {id: true}});
    const res = await casey.get('/site-api/my-applications');
    const ids = (res.json.items as {id: number}[]).map(i => i.id);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(notMine.id);
    expect((res.json.counts as {new: number}).new).toBe(1);
  });
});
