import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {overLimit} from '../../src/server/routes/applications';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * Apply + applicants (F4, F16, F36, F39) against a real Postgres: duplicate apply, the per-IP
 * limit and honeypot, no cross-company access, the resume retention guard, status emails once.
 * The platform's file storage is faked below (the harness answers 404 for anything else).
 */
let fileSeq = 0;
/** What the stored file starts with (the first-bytes check reads it); and the files deleted. */
let storedBytes = '%PDF-1.7\n';
const deleted: string[] = [];
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.includes('/api/site/v1/files') ? new URL(url).pathname.replace('/api/site/v1/files', '') : null;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status});
  if (path === '/uploads') {
    const id = `file_${String(++fileSeq).padStart(26, '0')}`;
    return json(201, {data: {file: {id}, upload: {method: 'PUT', url: `/__platform/files/uploads/${id}`, headers: {}, expiresAt: ''}}});
  }
  if (path?.endsWith('/complete')) return json(200, {data: {file: {id: path.split('/')[1], status: 'ready'}}});
  if (path?.endsWith('/delete')) {
    deleted.push(path.split('/')[1]!);
    return json(200, {data: {deleted: true}});
  }
  if (url.startsWith('https://files.example.test/')) return new Response(storedBytes, {status: 206});
  if (path?.endsWith('/url')) return json(200, {data: {url: 'https://files.example.test/x?sig=1', expiresAt: new Date().toISOString()}});
  return harnessFetch(input, init);
};

const OWNER_A = 'a-owner@example.test';
const OWNER_B = 'b-owner@example.test';
const ADMIN = 'staff@example.test';

async function setRoles(email: string, ...slugs: string[]) {
  const id = await userId(email);
  const roles = await db.role.findMany({where: {slug: {in: slugs}}, select: {id: true}});
  await db.userRole.deleteMany({where: {userId: id}});
  await db.userRole.createMany({data: roles.map(role => ({userId: id, roleId: role.id}))});
}

async function makeJob(companyId: number, slug: string) {
  const category = await db.category.upsert({where: {slug: 'apply-test'}, create: {name: 'Apply test', slug: 'apply-test'}, update: {}, select: {id: true}});
  return db.job.create({
    data: {
      companyId,
      categoryId: category.id,
      title: `Job ${slug}`,
      slug,
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
}

/** Upload a resume and apply; returns the apply response. */
async function apply(browser: Browser, slug: string, email: string, extra: Record<string, unknown> = {}) {
  const grant = await browser.post('/site-api/applications/resume', {name: 'cv.pdf', contentType: 'application/pdf', size: 1000});
  expect(grant.status).toBe(201);
  const token = grant.json.token as string;
  expect((await browser.post('/site-api/applications/resume/complete', {token})).status).toBe(200);
  return browser.post(`/site-api/applications/jobs/${slug}/apply`, {
    name: 'Casey Candidate',
    email,
    consent: true,
    resumeToken: token,
    ...extra,
  });
}

describe.skipIf(!DATABASE_URL)('applications (integration, real Postgres)', () => {
  let ownerA: Browser;
  let ownerB: Browser;
  let admin: Browser;
  let jobA: {id: number; slug: string};

  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    forgetBoardSettings();
    storedBytes = '%PDF-1.7\n';
    deleted.length = 0;
    admin = await signedIn(app, ADMIN, undefined, '203.0.113.30');
    ownerA = await signedIn(app, OWNER_A, undefined, '203.0.113.31');
    ownerB = await signedIn(app, OWNER_B, undefined, '203.0.113.32');
    await setRoles(OWNER_A, 'member');
    await setRoles(OWNER_B, 'member');
    await setRoles(ADMIN, 'admin');
    // The admin role holds site:applicant:read (catalogue default; made sure of here).
    const [role, permission] = await Promise.all([
      db.role.findUniqueOrThrow({where: {slug: 'admin'}, select: {id: true}}),
      db.permission.upsert({where: {codename: 'site:applicant:read'}, create: {codename: 'site:applicant:read', title: 'See all applicants'}, update: {}, select: {id: true}}),
    ]);
    await db.rolePermission.upsert({where: {roleId_permissionId: {roleId: role.id, permissionId: permission.id}}, create: {roleId: role.id, permissionId: permission.id}, update: {}});
    const a = await db.company.create({data: {name: 'A Co', slug: 'a-co', ownerUserId: await userId(OWNER_A)}, select: {id: true}});
    await db.company.create({data: {name: 'B Co', slug: 'b-co', ownerUserId: await userId(OWNER_B)}, select: {id: true}});
    jobA = await makeJob(a.id, 'job-a');
  });

  it('applies once per email: a second application answers like the first (no oracle), stored and emailed once', async () => {
    const guest = new Browser(app, '198.51.100.1');
    const first = await apply(guest, jobA.slug, 'Casey@Example.test');
    expect(first.status).toBe(201);
    const again = await apply(guest, jobA.slug, 'casey@example.test');
    // Same answer as a new application: nobody learns whether this address applied.
    expect(again.status).toBe(first.status);
    expect(again.json).toEqual(first.json);
    expect(await db.emailLog.count({where: {templateKey: 'application-confirmation'}})).toBe(1);
    const job = await db.job.findUniqueOrThrow({where: {id: jobA.id}, select: {applicationCount: true}});
    expect(job.applicationCount).toBe(1);
    const row = await db.application.findFirstOrThrow({select: {email: true, resumeFileId: true, consentText: true}});
    expect(row.email).toBe('casey@example.test');
    expect(row.resumeFileId).toMatch(/^file_/);
    expect(row.consentText).toMatch(/180 days/);
    const templates = (await db.emailLog.findMany({select: {templateKey: true, to: true}})).map(e => `${e.templateKey}:${e.to}`);
    expect(templates).toEqual(expect.arrayContaining(['application-confirmation:casey@example.test', `new-applicant:${OWNER_A}`]));
  });

  it('a resume token is used once, and consent is required', async () => {
    const guest = new Browser(app, '198.51.100.2');
    const noConsent = await apply(guest, jobA.slug, 'x@example.test', {consent: false});
    expect(noConsent.status).toBe(422);
    expect((noConsent.json.fields as Record<string, string>).consent).toBeTruthy();
    const bad = await guest.post(`/site-api/applications/jobs/${jobA.slug}/apply`, {name: 'X', email: 'y@example.test', consent: true, resumeToken: 'a'.repeat(43)});
    expect(bad.status).toBe(422);
    expect((bad.json.fields as Record<string, string>).resume).toBeTruthy();
  });

  it('more than 5 applications per IP an hour, or a filled honeypot, are "accepted" but never saved', async () => {
    const guest = new Browser(app, '198.51.100.3');
    for (let i = 0; i < 5; i++) expect((await apply(guest, jobA.slug, `p${i}@example.test`)).status).toBe(201);
    const sixth = await apply(guest, jobA.slug, 'p6@example.test');
    expect(sixth.status).toBe(201);
    const bot = await new Browser(app, '198.51.100.4').post(`/site-api/applications/jobs/${jobA.slug}/apply`, {website: 'spam', name: 'Bot'});
    expect(bot.status).toBe(201);
    expect(await db.application.count()).toBe(5);
  });

  it('employers reach only their own company’s applicants; staff reach all; single-company mode closes the employer side', async () => {
    expect((await apply(new Browser(app, '198.51.100.5'), jobA.slug, 'c@example.test')).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;

    const own = await ownerA.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`);
    expect(own.status).toBe(200);
    expect((own.json.items as {email: string}[]).map(r => r.email)).toEqual(['c@example.test']);

    expect((await ownerB.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(404);
    expect((await ownerB.get(`/site-api/applications/jobs/${jobA.id}/applicants/export?status=`)).status).toBe(404);
    expect((await ownerB.request('PATCH', `/site-api/applications/${appId}`, {status: 'rejected'})).status).toBe(404);
    expect((await ownerB.post(`/site-api/applications/${appId}/resume-link`)).status).toBe(404);
    expect((await ownerB.get('/site-api/applications/all?status=&before=&job=')).status).toBe(403);
    expect((await new Browser(app).get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(401);

    const all = await admin.get('/site-api/applications/all?status=&before=&job=');
    expect(all.status).toBe(200);
    expect((all.json.items as {job: {company: string}}[])[0]!.job.company).toBe('A Co');

    // Admin resume downloads are audited; the employer's own are not.
    expect((await ownerA.post(`/site-api/applications/${appId}/resume-link`)).status).toBe(200);
    expect((await admin.post(`/site-api/applications/${appId}/resume-link`)).status).toBe(200);
    expect(await db.auditEvent.count({where: {action: 'resume_downloaded'}})).toBe(2);

    const companyA = await db.company.findFirstOrThrow({where: {slug: 'a-co'}, select: {id: true}});
    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, boardMode: 'single_company', ownerCompanyId: companyA.id}, update: {boardMode: 'single_company', ownerCompanyId: companyA.id}});
    forgetBoardSettings();
    expect((await ownerA.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(404);
    expect((await admin.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(200);
  });

  it('each status email goes to the candidate at most once; notes stay private', async () => {
    expect((await apply(new Browser(app, '198.51.100.6'), jobA.slug, 'd@example.test')).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    const path = `/site-api/applications/${appId}`;
    expect((await ownerA.request('PATCH', path, {status: 'shortlisted', notes: 'Strong.'})).status).toBe(200);
    expect((await ownerA.request('PATCH', path, {status: 'rejected'})).status).toBe(200);
    // Back and forth: neither email goes out a second time.
    expect((await ownerA.request('PATCH', path, {status: 'shortlisted'})).status).toBe(200);
    const res = await ownerA.request('PATCH', path, {status: 'rejected'});
    expect((res.json.applicant as {status: string; notes: string}).notes).toBe('Strong.');
    const mails = (key: string) => db.emailLog.count({where: {templateKey: key}});
    expect(await mails('application-shortlisted')).toBe(1);
    expect(await mails('application-rejected')).toBe(1);
  });

  it('a resume past the retention period answers 410 everywhere, even before the purge', async () => {
    expect((await apply(new Browser(app, '198.51.100.7'), jobA.slug, 'e@example.test')).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    await db.application.update({where: {id: appId}, data: {createdAt: new Date(Date.now() - 181 * 86_400_000)}});

    for (const browser of [ownerA, admin]) {
      const link = await browser.post(`/site-api/applications/${appId}/resume-link`);
      expect(link.status).toBe(410);
      expect(link.json.error).toBe('resume_expired');
    }
    const list = await ownerA.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`);
    const row = (list.json.items as {resumeExpired: boolean; resumeFileName: string | null}[])[0]!;
    expect(row).toMatchObject({resumeExpired: true, resumeFileName: null});
    const csv = await ownerA.get(`/site-api/applications/jobs/${jobA.id}/applicants/export?status=`);
    expect(csv.status).toBe(200);
    expect(String(csv.json.text)).toContain('Resume deleted after 180 days (privacy policy)');
  });
  it('the job’s own employer cannot apply, and the form is hidden for them and for staff', async () => {
    const res = await apply(ownerA, jobA.slug, OWNER_A);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('own_job');
    const path = `/site-api/applications/jobs/${jobA.slug}/can-apply`;
    expect((await ownerA.get(path)).json).toEqual({canApply: false, reason: 'own_job'});
    expect((await admin.get(path)).json).toEqual({canApply: false, reason: 'staff'});
    expect((await ownerB.get(path)).json).toEqual({canApply: true, reason: null});
    expect((await new Browser(app).get(path)).json).toEqual({canApply: true, reason: null});
  });

  it('a company without an owner account sends the new-applicant email to applicant staff', async () => {
    const orphan = await db.company.create({data: {name: 'Imported Co', slug: 'imported-co'}, select: {id: true}});
    const job = await makeJob(orphan.id, 'job-orphan');
    expect((await apply(new Browser(app, '198.51.100.8'), job.slug, 'f@example.test')).status).toBe(201);
    const to = (await db.emailLog.findMany({where: {templateKey: 'new-applicant'}, select: {to: true}})).map(e => e.to);
    expect(to).toEqual([ADMIN]);
  });
  it('a parallel burst against the per-IP limit lets at most 5 through (insert, then count)', async () => {
    // The limiter itself, on the test client: the harness ends its DB client after each request,
    // so parallel HTTP requests in one process do not work here.
    const ip = 'f'.repeat(64);
    const over = await Promise.all(Array.from({length: 12}, () => overLimit(db, 'apply', ip, 5)));
    expect(over.filter(o => !o).length).toBeLessThanOrEqual(5);
    expect(await overLimit(db, 'apply', ip, 5)).toBe(true);
  });
  it('a "PDF" whose bytes are not a PDF is refused at complete and deleted', async () => {
    storedBytes = '<html><script>';
    const guest = new Browser(app, '198.51.100.10');
    const grant = await guest.post('/site-api/applications/resume', {name: 'cv.pdf', contentType: 'application/pdf', size: 1000});
    const done = await guest.post('/site-api/applications/resume/complete', {token: grant.json.token});
    expect(done.status).toBe(422);
    expect((done.json.fields as Record<string, string>).resume).toMatch(/not a real PDF/);
    expect(deleted).toHaveLength(1);
    expect(await db.resumeUpload.count()).toBe(0);
  });
});
