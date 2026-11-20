import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {sha256Hex} from '../../src/platform/auth/encoding';
import {app} from '../../src/server/app';
import {forgetBoardSettings} from '../../src/server/board/brand';
import {runPurge} from '../../src/server/board/tasks';
import {overLimit} from '../../src/server/routes/applications';
import {Browser, configureEnv, DATABASE_URL, db, ORIGIN, resetDatabase, signedIn, userId} from './support/harness';

/**
 * Apply + applicants (F4, F16, F36, F39) against a real Postgres: applying needs a job seeker
 * account (profile with photo, CV and phone), once per account; the per-IP limit; no cross-company
 * access; the resume retention guard; status emails once; the shared profile CV is never deleted
 * while something uses it. The platform's file storage is faked below (the harness answers 404 for
 * anything else).
 */
let fileSeq = 0;
/** What each stored file starts with (the first-bytes check reads it); and the files deleted. */
const PNG = '\x89PNG\r\n\x1a\n0000';
const PDF = '%PDF-1.7\n';
const storedBytes = new Map<string, string>();
/** The next upload's bytes (default: right for its type). */
let nextBytes: string | null = null;
const uploads = new Map<string, {name: string; contentType: string; size: number; visibility: string}>();
let lastFile = '';
const deleted: string[] = [];
/** True: storage refuses every delete (an outage). */
let failDeletes = false;
/** Calls to storage's "complete" (a confirmed upload is never confirmed again). */
let completeCalls = 0;
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.includes('/api/site/v1/files') ? new URL(url).pathname.replace('/api/site/v1/files', '') : null;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status});
  if (path === '/uploads') {
    const id = `file_${String(++fileSeq).padStart(26, '0')}`;
    const asked = JSON.parse(String(init?.body ?? '{}')) as {name: string; contentType: string; size: number; visibility?: string};
    uploads.set(id, {name: asked.name, contentType: asked.contentType, size: asked.size, visibility: asked.visibility ?? 'private'});
    storedBytes.set(id, nextBytes ?? (asked.contentType.startsWith('image/') ? PNG : PDF));
    nextBytes = null;
    return json(201, {data: {file: {id}, upload: {method: 'PUT', url: `/__platform/files/uploads/${id}`, headers: {}, expiresAt: ''}}});
  }
  if (path?.endsWith('/complete') && ++completeCalls) {
    const id = path.split('/')[1]!;
    return json(200, {data: {file: {id, status: 'ready', ...uploads.get(id)}}});
  }
  if (path?.endsWith('/delete')) {
    if (failDeletes) return json(503, {error: {code: 'E_UNAVAILABLE', message: 'down'}});
    deleted.push(path.split('/')[1]!);
    return json(200, {data: {deleted: true}});
  }
  if (url.startsWith('https://files.example.test/')) return new Response(Buffer.from(storedBytes.get(lastFile) ?? PDF, 'latin1'), {status: 206});
  if (path?.endsWith('/url')) {
    lastFile = path.split('/')[1]!;
    return json(200, {data: {url: `https://files.example.test/${lastFile}?sig=1`, expiresAt: new Date().toISOString()}});
  }
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

async function makeJob(companyId: number, slug: string, source = 'paid') {
  const category = await db.category.upsert({where: {slug: 'apply-test'}, create: {name: 'Apply test', slug: 'apply-test'}, update: {}, select: {id: true}});
  return db.job.create({
    data: {
      companyId,
      categoryId: category.id,
      title: `Job ${slug}`,
      slug,
      source,
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

/** Upload one profile file (photo / resume) through the three steps; the `complete` answer. */
async function uploadFile(browser: Browser, kind: 'photo' | 'resume', bytes?: string) {
  const type = kind === 'photo' ? 'image/png' : 'application/pdf';
  if (bytes !== undefined) nextBytes = bytes;
  const grant = await browser.post(`/site-api/applicant-profile/${kind}`, {name: kind === 'photo' ? 'me.png' : 'cv.pdf', contentType: type, size: 1000});
  expect(grant.status).toBe(201);
  return browser.post(`/site-api/applicant-profile/${kind}/complete`, {fileId: grant.json.fileId, token: grant.json.token});
}

/** A signed-in job seeker with a complete profile (photo, CV, phone). */
async function applicant(email: string, ip: string) {
  const browser = await signedIn(app, email, undefined, ip);
  expect((await browser.post('/site-api/applicant-profile/start')).status).toBe(200);
  expect((await uploadFile(browser, 'photo')).status).toBe(200);
  expect((await uploadFile(browser, 'resume')).status).toBe(200);
  expect((await browser.request('PUT', '/site-api/applicant-profile', {phone: '+1 555 123 4567', headline: 'Engineer'})).status).toBe(200);
  return browser;
}

/** Apply from the profile. */
const apply = (browser: Browser, slug: string, extra: Record<string, unknown> = {}) =>
  browser.post(`/site-api/applications/jobs/${slug}/apply`, {consent: true, coverNote: 'Hello.', ...extra});

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
    deleted.length = 0;
    nextBytes = null;
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

  it('applies once per account, from the profile: a second try is a 409, stored and emailed once', async () => {
    const {updatedAt: updatedBefore} = await db.job.findUniqueOrThrow({where: {id: jobA.id}, select: {updatedAt: true}});
    const casey = await applicant('casey@example.test', '198.51.100.1');
    const first = await apply(casey, jobA.slug);
    expect(first.status).toBe(201);
    const again = await apply(casey, jobA.slug);
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('already_applied');
    expect(await db.emailLog.count({where: {templateKey: 'application-confirmation'}})).toBe(1);
    const job = await db.job.findUniqueOrThrow({where: {id: jobA.id}, select: {applicationCount: true, updatedAt: true}});
    expect(job.applicationCount).toBe(1);
    // The counter leaves `updated_at` (the sitemap's lastmod) alone.
    expect(job.updatedAt).toEqual(updatedBefore);
    const row = await db.application.findFirstOrThrow({select: {email: true, name: true, phone: true, resumeFileId: true, consentText: true, applicantUserId: true}});
    const profile = await db.applicantProfile.findFirstOrThrow({select: {userId: true, resumeFileId: true}});
    // Name, email, phone and CV come from the session and the profile, never the request.
    expect(row).toMatchObject({email: 'casey@example.test', name: 'casey', phone: '+1 555 123 4567', applicantUserId: profile.userId});
    expect(row.resumeFileId).toBe(profile.resumeFileId);
    expect(row.consentText).toMatch(/180 days/);
    const templates = (await db.emailLog.findMany({select: {templateKey: true, to: true}})).map(e => `${e.templateKey}:${e.to}`);
    expect(templates).toEqual(expect.arrayContaining(['application-confirmation:casey@example.test', `new-applicant:${OWNER_A}`]));
    // Fields the request sends about the person are ignored.
    const other = await makeJob((await db.company.findFirstOrThrow({where: {slug: 'a-co'}, select: {id: true}})).id, 'job-other');
    expect((await apply(casey, other.slug, {email: 'victim@example.test', name: 'Someone else'})).status).toBe(201);
    expect(await db.application.count({where: {email: 'victim@example.test'}})).toBe(0);
  });

  it('guests, accounts without a profile and incomplete profiles cannot apply; consent is required', async () => {
    const guest = new Browser(app, '198.51.100.2');
    expect((await apply(guest, jobA.slug)).status).toBe(401);
    expect((await guest.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toEqual({canApply: false, reason: 'sign_in'});

    const fresh = await signedIn(app, 'fresh@example.test', undefined, '198.51.100.2');
    expect((await apply(fresh, jobA.slug)).json.error).toBe('not_applicant');
    expect((await fresh.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toEqual({canApply: false, reason: 'choose_kind'});

    expect((await fresh.post('/site-api/applicant-profile/start')).status).toBe(200);
    const incomplete = await apply(fresh, jobA.slug);
    expect(incomplete.status).toBe(422);
    expect(incomplete.json).toMatchObject({error: 'profile_incomplete', missing: ['photo', 'resume']});
    expect((await fresh.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: false, reason: 'incomplete', missing: ['photo', 'resume']});
    // A photo and a CV are enough: the email is the account's own, the phone is optional.
    expect((await uploadFile(fresh, 'photo')).status).toBe(200);
    expect((await fresh.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({reason: 'incomplete', missing: ['resume']});
    expect((await uploadFile(fresh, 'resume')).status).toBe(200);
    expect((await fresh.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: true, profile: {email: 'fresh@example.test', phone: null}});
    const other = await makeJob((await db.company.findFirstOrThrow({where: {slug: 'a-co'}, select: {id: true}})).id, 'job-no-phone');
    expect((await apply(fresh, other.slug)).status).toBe(201);
    expect(await db.application.findFirstOrThrow({where: {jobId: other.id}, select: {email: true, phone: true}})).toEqual({email: 'fresh@example.test', phone: null});

    const ready = await applicant('ready@example.test', '198.51.100.2');
    expect((await ready.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: true, reason: null, profile: {email: 'ready@example.test', phone: '+1 555 123 4567', resumeFileName: 'cv.pdf'}});
    const noConsent = await apply(ready, jobA.slug, {consent: false});
    expect(noConsent.status).toBe(422);
    expect((noConsent.json.fields as Record<string, string>).consent).toBeTruthy();
    expect(await db.application.count({where: {jobId: jobA.id}})).toBe(0);
    expect((await apply(ready, jobA.slug)).status).toBe(201);
    expect((await ready.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: false, reason: 'applied'});
  });

  it('more than 5 applications per IP an hour are refused (429) and never saved', async () => {
    const companyId = (await db.company.findFirstOrThrow({where: {slug: 'a-co'}, select: {id: true}})).id;
    const jobs = await Promise.all(Array.from({length: 6}, (_, i) => makeJob(companyId, `burst-${i}`)));
    const busy = await applicant('busy@example.test', '198.51.100.3');
    for (let i = 0; i < 5; i++) expect((await apply(busy, jobs[i]!.slug)).status).toBe(201);
    expect((await apply(busy, jobs[5]!.slug)).status).toBe(429);
    expect(await db.application.count()).toBe(5);
  });

  it('refused tries (profile not finished, job gone) do not use up the hour: the real application still goes through', async () => {
    const seeker = await signedIn(app, 'eager@example.test', undefined, '198.51.100.4');
    expect((await seeker.post('/site-api/applicant-profile/start')).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      const early = await apply(seeker, jobA.slug);
      expect(early.status).toBe(422);
      // In words, not a comma list.
      expect(early.json.message).toBe('Add a photo and your CV to your profile first.');
    }
    expect((await apply(seeker, 'no-such-job')).status).toBe(422);
    expect((await uploadFile(seeker, 'photo')).status).toBe(200);
    expect((await uploadFile(seeker, 'resume')).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await apply(seeker, 'no-such-job')).status).toBe(404);
    expect((await apply(seeker, jobA.slug)).status).toBe(201);
    expect(await db.boardAttempt.count({where: {kind: 'apply'}})).toBe(1);
  });

  it('an account is a job seeker or a company, never both', async () => {
    // A company owner cannot become a job seeker…
    const start = await ownerA.post('/site-api/applicant-profile/start');
    expect(start.status).toBe(409);
    expect(start.json.error).toBe('employer_account');
    expect((await ownerA.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({reason: 'own_job'});
    expect((await ownerB.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({reason: 'employer_account'});
    // …staff neither…
    expect((await admin.post('/site-api/applicant-profile/start')).json.error).toBe('staff_account');
    // …and a job seeker never reaches the employer area.
    const seeker = await applicant('seeker@example.test', '198.51.100.14');
    const employer = await seeker.get('/site-api/employer/company');
    expect(employer.status).toBe(403);
    expect(employer.json.error).toBe('applicant_account');
    expect((await seeker.post('/site-api/employer/post', {job: {}, tierId: null})).status).toBe(403);
    expect((await seeker.get('/site-api/applicant-profile')).json).toMatchObject({kind: 'applicant', profile: {email: 'seeker@example.test', hasPhoto: true, resumeFileName: 'cv.pdf'}});
    expect((await seeker.get('/site-api/me')).json).toMatchObject({account: {kind: 'applicant'}});
    expect((await ownerA.get('/site-api/me')).json).toMatchObject({account: {kind: 'employer'}});
  });

  it('the employer sees the applicant’s profile and photo; another company and strangers do not', async () => {
    const seeker = await applicant('pat@example.test', '198.51.100.15');
    expect((await seeker.request('PUT', '/site-api/applicant-profile', {phone: '+1 555 123 4567', headline: 'Designer', skills: 'Figma, CSS', experienceYears: 4})).status).toBe(200);
    expect((await apply(seeker, jobA.slug)).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    const seen = await ownerA.get(`/site-api/applications/${appId}/profile`);
    expect(seen.status).toBe(200);
    expect(seen.json.profile).toMatchObject({headline: 'Designer', skills: 'Figma, CSS', experienceYears: 4, hasPhoto: true});
    expect(JSON.stringify(seen.json)).not.toMatch(/file_/);
    expect((await ownerA.get(`/site-api/applications/${appId}/photo`)).status).toBe(302);
    // A company's candidate is the company's: the admin does not see their profile either.
    for (const other of [ownerB, admin, seeker, new Browser(app)]) {
      expect([401, 403, 404]).toContain((await other.get(`/site-api/applications/${appId}/profile`)).status);
      expect([401, 403, 404]).toContain((await other.get(`/site-api/applications/${appId}/photo`)).status);
    }
    // The own files: only the owner, and only their own.
    expect((await seeker.get('/site-api/applicant-profile/photo')).status).toBe(302);
    expect((await ownerB.get('/site-api/applicant-profile/photo')).status).toBe(404);
  });

  it('a profile upload is bound to its account: another account cannot claim the file', async () => {
    const one = await applicant('one@example.test', '198.51.100.16');
    const two = await applicant('two@example.test', '198.51.100.17');
    const grant = await one.post('/site-api/applicant-profile/photo', {name: 'me.png', contentType: 'image/png', size: 1000});
    const stolen = await two.post('/site-api/applicant-profile/photo/complete', {fileId: grant.json.fileId, token: grant.json.token});
    expect(stolen.status).toBe(422);
    expect((await one.post('/site-api/applicant-profile/photo', {name: 'me.svg', contentType: 'image/svg+xml', size: 1000})).status).toBe(422);
    expect((await one.post('/site-api/applicant-profile/resume', {name: 'cv.pdf', contentType: 'application/pdf', size: 50 * 1024 * 1024})).status).toBe(422);
  });

  it('employers reach only their own company’s applicants; staff only the board’s own jobs; single-company mode closes the employer side', async () => {
    expect((await apply(await applicant('c@example.test', '198.51.100.5'), jobA.slug)).status).toBe(201);
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

    // The staff never reach a company's applicants: not listed, not read, not changed, no resume.
    expect((await admin.get('/site-api/applications/all?status=&before=&job=')).json.items).toEqual([]);
    expect((await admin.get('/site-api/applications/all/jobs')).json.jobs).toEqual([]);
    expect((await admin.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(404);
    expect((await admin.request('PATCH', `/site-api/applications/${appId}`, {status: 'rejected'})).status).toBe(404);
    expect((await admin.post(`/site-api/applications/${appId}/resume-link`)).status).toBe(404);
    expect(await db.application.findUniqueOrThrow({where: {id: appId}, select: {status: true}})).toEqual({status: 'new'});

    // The board's own job (source `admin`): the staff's to read and decide on.
    const companyA = await db.company.findFirstOrThrow({where: {slug: 'a-co'}, select: {id: true}});
    const house = await makeJob(companyA.id, 'house-job', 'admin');
    expect((await apply(await applicant('h@example.test', '198.51.100.6'), house.slug)).status).toBe(201);
    const houseApp = (await db.application.findFirstOrThrow({where: {jobId: house.id}, select: {id: true}})).id;
    const all = await admin.get('/site-api/applications/all?status=&before=&job=');
    expect(all.status).toBe(200);
    expect((all.json.items as {id: number}[]).map(r => r.id)).toEqual([houseApp]);

    // Seeing the board's applicants is not changing them: without site:applicant:manage the staff
    // member's PATCH is a 404 (nothing changes, no email); with it, a 200.
    const adminRole = await db.role.findUniqueOrThrow({where: {slug: 'admin'}, select: {id: true}});
    const manage = await db.permission.upsert({
      where: {codename: 'site:applicant:manage'},
      create: {codename: 'site:applicant:manage', title: 'Update all applicants'},
      update: {},
      select: {id: true},
    });
    await db.rolePermission.deleteMany({where: {roleId: adminRole.id, permissionId: manage.id}});
    expect((await admin.request('PATCH', `/site-api/applications/${houseApp}`, {status: 'rejected', notes: 'x'})).status).toBe(404);
    expect(await db.application.findUniqueOrThrow({where: {id: houseApp}, select: {status: true, employerNotes: true}})).toEqual({status: 'new', employerNotes: null});
    expect(await db.emailLog.count({where: {templateKey: 'application-rejected'}})).toBe(0);
    await db.rolePermission.create({data: {roleId: adminRole.id, permissionId: manage.id}});
    expect((await admin.request('PATCH', `/site-api/applications/${houseApp}`, {notes: 'Seen by staff.'})).status).toBe(200);

    // Admin resume downloads are audited; the employer's own are not.
    expect((await ownerA.post(`/site-api/applications/${appId}/resume-link`)).status).toBe(200);
    expect((await admin.post(`/site-api/applications/${houseApp}/resume-link`)).status).toBe(200);
    expect(await db.auditEvent.count({where: {action: 'resume_downloaded'}})).toBe(2);

    await db.boardSettings.upsert({where: {id: 1}, create: {id: 1, boardMode: 'single_company', ownerCompanyId: companyA.id}, update: {boardMode: 'single_company', ownerCompanyId: companyA.id}});
    forgetBoardSettings();
    expect((await ownerA.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(404);
    expect((await admin.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(200);
  });

  it('an application follows the account: after an email change it still counts as applied and the email goes to the new address', async () => {
    const casey = await applicant('casey@example.test', '198.51.100.21');
    expect((await apply(casey, jobA.slug)).status).toBe(201);
    // As if the account changed its address after applying (the row keeps the old one).
    await db.application.updateMany({data: {email: 'casey-old@example.test'}});
    expect((await casey.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: false, reason: 'applied'});
    const again = await apply(casey, jobA.slug);
    expect(again.status).toBe(409);
    expect(await db.application.count()).toBe(1);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    expect((await ownerA.request('PATCH', `/site-api/applications/${appId}`, {status: 'shortlisted'})).status).toBe(200);
    expect(await db.emailLog.findMany({where: {templateKey: 'application-shortlisted'}, select: {to: true}})).toEqual([{to: 'casey@example.test'}]);
  });

  it('an address that passed to a new account does not carry the old account\'s applications', async () => {
    const casey = await applicant('casey@example.test', '198.51.100.23');
    expect((await apply(casey, jobA.slug)).status).toBe(201);
    // Casey applied under the address dana@ has now (Casey changed address, Dana signed up with it).
    await db.application.updateMany({data: {email: 'dana@example.test'}});
    const dana = await applicant('dana@example.test', '198.51.100.24');
    expect((await dana.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: true});
    expect((await apply(dana, jobA.slug)).status).toBe(201);
    expect(await db.application.count({where: {jobId: jobA.id}})).toBe(2);
    expect((await db.job.findUniqueOrThrow({where: {id: jobA.id}, select: {applicationCount: true}})).applicationCount).toBe(2);
    // Casey's own application still counts for Casey.
    expect((await casey.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: false, reason: 'applied'});

    // An old GUEST application (no account) with an address still counts for that address, once per job.
    await db.application.deleteMany({where: {email: 'dana@example.test', applicantUserId: {not: null}}});
    const guestRow = {jobId: jobA.id, name: 'Dana', email: 'dana@example.test', consentAt: new Date(), consentText: 'x'};
    await db.application.create({data: guestRow});
    expect((await dana.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toMatchObject({canApply: false, reason: 'applied'});
    await expect(db.application.create({data: guestRow})).rejects.toThrow();
  });

  it('a closed job says so before the form, and takes no application', async () => {
    const casey = await applicant('casey@example.test', '198.51.100.22');
    await db.job.update({where: {id: jobA.id}, data: {status: 'closed'}});
    forgetBoardSettings();
    expect((await casey.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toEqual({canApply: false, reason: 'closed'});
    expect((await apply(casey, jobA.slug)).status).toBe(404);
  });

  it('each status email goes to the candidate at most once; notes stay private', async () => {
    expect((await apply(await applicant('d@example.test', '198.51.100.6'), jobA.slug)).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    const path = `/site-api/applications/${appId}`;
    expect((await ownerA.request('PATCH', path, {status: 'shortlisted', notes: 'Strong.'})).status).toBe(200);
    expect((await ownerA.request('PATCH', path, {status: 'approved'})).status).toBe(200);
    expect((await ownerA.request('PATCH', path, {status: 'rejected'})).status).toBe(200);
    // Back and forth: no email goes out a second time.
    expect((await ownerA.request('PATCH', path, {status: 'shortlisted'})).status).toBe(200);
    expect((await ownerA.request('PATCH', path, {status: 'approved'})).status).toBe(200);
    const res = await ownerA.request('PATCH', path, {status: 'rejected'});
    expect((res.json.applicant as {status: string; notes: string}).notes).toBe('Strong.');
    const mails = (key: string) => db.emailLog.count({where: {templateKey: key}});
    expect(await mails('application-shortlisted')).toBe(1);
    expect(await mails('application-approved')).toBe(1);
    expect(await mails('application-rejected')).toBe(1);
  });

  it('a blocked company still reads its applicants but cannot change them (no candidate emails)', async () => {
    expect((await apply(await applicant('e@example.test', '198.51.100.7'), jobA.slug)).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    await db.company.update({where: {slug: 'a-co'}, data: {isBlocked: true}});
    expect((await ownerA.request('PATCH', `/site-api/applications/${appId}`, {status: 'shortlisted'})).status).toBe(404);
    expect((await ownerA.get(`/site-api/applications/jobs/${jobA.id}/applicants?status=&before=`)).status).toBe(200);
    expect(await db.emailLog.count({where: {templateKey: 'application-shortlisted'}})).toBe(0);
  });

  it('a resume past the retention period answers 410 everywhere, even before the purge', async () => {
    expect((await apply(await applicant('e@example.test', '198.51.100.7'), jobA.slug)).status).toBe(201);
    const appId = (await db.application.findFirstOrThrow({select: {id: true}})).id;
    await db.application.update({where: {id: appId}, data: {createdAt: new Date(Date.now() - 181 * 86_400_000)}});

    for (const browser of [ownerA]) {
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
    // The profile (birth date, address) and the photo end with the CV.
    for (const browser of [ownerA]) {
      const profile = await browser.get(`/site-api/applications/${appId}/profile`);
      expect(profile.status).toBe(200);
      expect(profile.json.profile).toBeNull();
      expect((await browser.get(`/site-api/applications/${appId}/photo`)).status).toBe(404);
    }
  });
  it('staff see a note instead of the form', async () => {
    const path = `/site-api/applications/jobs/${jobA.slug}/can-apply`;
    expect((await admin.get(path)).json).toEqual({canApply: false, reason: 'staff'});
    expect((await apply(admin, jobA.slug)).json.error).toBe('not_applicant');
  });

  it("a suspended employer's jobs take no applications, and nobody is emailed", async () => {
    const casey = await applicant('casey@example.test', '198.51.100.23');
    await db.user.update({where: {id: await userId(OWNER_A)}, data: {status: 'suspended'}});
    expect((await casey.get(`/site-api/applications/jobs/${jobA.slug}/can-apply`)).json).toEqual({canApply: false, reason: 'closed'});
    expect((await apply(casey, jobA.slug)).status).toBe(404);
    expect(await db.application.count()).toBe(0);
    expect(await db.emailLog.count({where: {templateKey: 'new-applicant'}})).toBe(0);
    // Active again: applications open again.
    await db.user.update({where: {id: await userId(OWNER_A)}, data: {status: 'active'}});
    expect((await apply(casey, jobA.slug)).status).toBe(201);
  });

  it('a company without an owner account sends the new-applicant email to applicant staff', async () => {
    const orphan = await db.company.create({data: {name: 'Imported Co', slug: 'imported-co'}, select: {id: true}});
    const job = await makeJob(orphan.id, 'job-orphan');
    expect((await apply(await applicant('f@example.test', '198.51.100.8'), job.slug)).status).toBe(201);
    const to = (await db.emailLog.findMany({where: {templateKey: 'new-applicant'}, select: {to: true}})).map(e => e.to);
    expect(to).toEqual([ADMIN]);
  });
  it('deleting a job keeps a CV the profile still uses; a CV nothing uses goes, via the purge when storage fails', async () => {
    const companyId = (await db.company.findFirstOrThrow({where: {slug: 'a-co'}, select: {id: true}})).id;
    const job = await makeJob(companyId, 'job-gone');
    const seeker = await applicant('g@example.test', '198.51.100.9');
    expect((await apply(seeker, job.slug)).status).toBe(201);
    const {resumeFileId} = await db.application.findFirstOrThrow({where: {jobId: job.id}, select: {resumeFileId: true}});
    expect(resumeFileId).toBeTruthy();

    // 1. The profile still has this CV: the job goes, the file stays.
    const kept = await admin.delete(`/site-api/manage/jobs/${job.id}`);
    expect(kept.status).toBe(200);
    expect(kept.json.filesLeft).toBe(0);
    expect(deleted).not.toContain(resumeFileId);
    expect(await db.resumeUpload.count({where: {fileId: resumeFileId!}})).toBe(0);

    // 2. Applied, then replaced the CV: the old file is only the application's now.
    const job2 = await makeJob(companyId, 'job-gone-2');
    expect((await apply(seeker, job2.slug)).status).toBe(201);
    expect((await uploadFile(seeker, 'resume')).status).toBe(200);
    expect(deleted).not.toContain(resumeFileId);
    failDeletes = true;
    try {
      const res = await admin.delete(`/site-api/manage/jobs/${job2.id}`);
      expect(res.status).toBe(200);
      expect(res.json.filesLeft).toBe(1);
    } finally {
      failDeletes = false;
    }
    // The upload row stays, detached and with nothing personal, until its file is gone.
    const left = await db.resumeUpload.findUniqueOrThrow({where: {fileId: resumeFileId!}, select: {applicationId: true, name: true, ipHash: true}});
    expect(left).toEqual({applicationId: null, name: 'deleted', ipHash: null});
    await runPurge(db, ORIGIN);
    expect(deleted).toContain(resumeFileId);
    expect(await db.resumeUpload.count({where: {fileId: resumeFileId!}})).toBe(0);
  });

  it('the retention purge lets go of a shared CV without deleting it', async () => {
    const seeker = await applicant('h@example.test', '198.51.100.18');
    expect((await apply(seeker, jobA.slug)).status).toBe(201);
    const app1 = await db.application.findFirstOrThrow({select: {id: true, resumeFileId: true}});
    await db.application.update({where: {id: app1.id}, data: {createdAt: new Date(Date.now() - 181 * 86_400_000)}});
    await runPurge(db, ORIGIN);
    expect(await db.application.findUniqueOrThrow({where: {id: app1.id}, select: {resumeFileId: true}})).toEqual({resumeFileId: null});
    expect(deleted).not.toContain(app1.resumeFileId);
    expect((await db.applicantProfile.findFirstOrThrow({select: {resumeFileId: true}})).resumeFileId).toBe(app1.resumeFileId);
  });

  it('a parallel burst against the per-IP limit lets at most 5 through (insert, then count)', async () => {
    // The limiter itself, on the test client: the harness ends its DB client after each request,
    // so parallel HTTP requests in one process do not work here.
    const ip = 'f'.repeat(64);
    const over = await Promise.all(Array.from({length: 12}, () => overLimit(db, 'apply', ip, 5)));
    expect(over.filter(o => !o).length).toBeLessThanOrEqual(5);
    expect(await overLimit(db, 'apply', ip, 5)).toBe(true);
  });
  it('a photo or CV whose bytes are not what they claim is refused at complete and deleted', async () => {
    const seeker = await applicant('i@example.test', '198.51.100.10');
    const before = await db.applicantProfile.findFirstOrThrow({select: {photoFileId: true, resumeFileId: true}});
    const photo = await uploadFile(seeker, 'photo', '<svg onload=alert(1)>');
    expect(photo.status).toBe(422);
    const cv = await uploadFile(seeker, 'resume', '<html><script>');
    expect(cv.status).toBe(422);
    expect(deleted).toHaveLength(2);
    expect(await db.applicantProfile.findFirstOrThrow({select: {photoFileId: true, resumeFileId: true}})).toEqual(before);
  });

  it('confirming an upload again answers the same without calling storage again; a new photo replaces (and deletes) the old', async () => {
    const seeker = await applicant('j@example.test', '198.51.100.11');
    const old = (await db.applicantProfile.findFirstOrThrow({select: {photoFileId: true}})).photoFileId;
    const grant = await seeker.post('/site-api/applicant-profile/photo', {name: 'me.png', contentType: 'image/png', size: 1000});
    const before = completeCalls;
    for (let i = 0; i < 3; i++) {
      const done = await seeker.post('/site-api/applicant-profile/photo/complete', {fileId: grant.json.fileId, token: grant.json.token});
      expect(done.status).toBe(200);
      expect(done.json).toMatchObject({kind: 'applicant', profile: {hasPhoto: true}});
    }
    expect(completeCalls - before).toBe(1);
    expect(deleted).toEqual([old]);
  });

  it('deleting the account deletes the job seeker profile, its photo, and a CV no application uses', async () => {
    const seeker = await applicant('l@example.test', '198.51.100.19');
    const files = await db.applicantProfile.findFirstOrThrow({select: {photoFileId: true, resumeFileId: true}});
    const res = await seeker.post('/site-api/auth/delete-account', {password: 'a long test passphrase', confirm: 'DELETE'});
    expect(res.status).toBe(200);
    expect(await db.applicantProfile.count()).toBe(0);
    expect(deleted).toEqual(expect.arrayContaining([files.photoFileId, files.resumeFileId]));
    // Deleted now, so nothing is left queued for the nightly purge.
    expect(await db.resumeUpload.count()).toBe(0);
  });

  it('the privacy tool deletes the job seeker profile with its photo and CV; the account stays', async () => {
    const seeker = await applicant('m@example.test', '198.51.100.20');
    expect((await apply(seeker, jobA.slug)).status).toBe(201);
    const files = await db.applicantProfile.findFirstOrThrow({select: {photoFileId: true, resumeFileId: true}});
    const role = await db.role.findUniqueOrThrow({where: {slug: 'admin'}, select: {id: true}});
    const p = await db.permission.upsert({where: {codename: 'site:privacy:manage'}, create: {codename: 'site:privacy:manage', title: 'Delete candidate data'}, update: {}, select: {id: true}});
    await db.rolePermission.upsert({where: {roleId_permissionId: {roleId: role.id, permissionId: p.id}}, create: {roleId: role.id, permissionId: p.id}, update: {}});

    const seen = await admin.post('/site-api/manage/privacy/lookup', {email: 'm@example.test'});
    expect(seen.json).toMatchObject({applications: 1, profile: true});
    const res = await admin.post('/site-api/manage/privacy/delete', {email: 'm@example.test'});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({deleted: {applications: 1, profiles: 1}, filesLeft: 0});
    expect(await db.applicantProfile.count()).toBe(0);
    expect(await db.application.count()).toBe(0);
    expect(deleted).toEqual(expect.arrayContaining([files.photoFileId, files.resumeFileId]));
    // The account stays: a plain account again, which may set up a profile anew.
    expect((await seeker.get('/site-api/me')).json).toMatchObject({viewer: {email: 'm@example.test'}, account: {kind: 'none'}});
    expect((await admin.post('/site-api/manage/privacy/lookup', {email: 'm@example.test'})).json).toMatchObject({applications: 0, profile: false});
  });

  it('a job sends at most 20 new-applicant emails an hour; the applications still arrive', async () => {
    // 20 already sent for this job this hour (a burst from many IPs).
    const ipHash = await sha256Hex(`notify-job:${jobA.id}`);
    await db.boardAttempt.createMany({data: Array.from({length: 20}, () => ({kind: 'notify', ipHash}))});
    expect((await apply(await applicant('k@example.test', '198.51.100.13'), jobA.slug)).status).toBe(201);
    expect(await db.application.count()).toBe(1);
    expect(await db.emailLog.count({where: {templateKey: 'new-applicant'}})).toBe(0);
    // The candidate's own confirmation is not part of it.
    expect(await db.emailLog.count({where: {templateKey: 'application-confirmation'}})).toBe(1);
  });
});
