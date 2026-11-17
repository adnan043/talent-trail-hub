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
    const category = await db.category.create({data: {name: 'Mine test', slug: 'mine-test'}, select: {id: true}});
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
});
