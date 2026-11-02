import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {runExpiry, runPurge} from '../../src/server/board/tasks';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** The board's scheduled tasks (F37 expiry, F36 purge) against a real Site Database. */
const DAY = 86_400_000;
const URL_ = 'https://shop.example.test/site-api/_platform/jobs';
const fileId = (n: number) => `file_${String(n).padStart(26, '0')}`;

let deleted: string[] = [];
let failDelete = new Set<string>();

async function company(ownerEmail?: string) {
  const owner = ownerEmail ? await db.user.create({data: {email: ownerEmail, passwordHash: 'x', name: 'Owner'}}) : null;
  return db.company.create({data: {name: 'Acme', slug: `acme-${Math.random().toString(36).slice(2, 8)}`, ownerUserId: owner?.id ?? null, activeJobCount: 0}});
}

async function job(companyId: number, data: Record<string, unknown>) {
  const category = await db.category.findFirstOrThrow({select: {id: true}});
  return db.job.create({
    data: {
      companyId,
      categoryId: category.id,
      title: 'Designer',
      slug: `job-${Math.random().toString(36).slice(2, 10)}`,
      descriptionHtml: '<p>x</p>',
      descriptionMd: 'x',
      employmentType: 'FULL_TIME',
      workplaceType: 'remote',
      status: 'published',
      publishedAt: new Date(Date.now() - 30 * DAY),
      ...data,
    },
  });
}

describe.skipIf(!DATABASE_URL)('board tasks (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase();
    deleted = [];
    failDelete = new Set();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const m = /\/api\/site\/v1\/files\/(file_[0-9a-z]{26})\/delete$/.exec(url);
      if (m) {
        if (failDelete.has(m[1]!)) return new Response('{}', {status: 500});
        deleted.push(m[1]!);
        return new Response(JSON.stringify({data: {deleted: true}}), {status: 200});
      }
      return real(input, init);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('expires jobs past their date, ends featured flags, reminds once; a re-run is a no-op', async () => {
    const co = await company('owner@example.com');
    const now = new Date();
    const past = await job(co.id, {title: 'Gone', expiresAt: new Date(now.getTime() - 60_000)});
    const soon = await job(co.id, {title: 'Soon', expiresAt: new Date(now.getTime() + 2 * DAY)});
    const later = await job(co.id, {title: 'Later', expiresAt: new Date(now.getTime() + 10 * DAY)});
    const featured = await job(co.id, {expiresAt: new Date(now.getTime() + 20 * DAY), isFeatured: true, featuredUntil: new Date(now.getTime() - 1000)});
    const closed = await job(co.id, {status: 'closed', expiresAt: new Date(now.getTime() - DAY)});

    const first = await runExpiry(db, URL_, now);
    expect(first.summary).toEqual({expired: 1, unfeatured: 1, reminded: 1});

    const rows = await db.job.findMany({select: {id: true, status: true, isFeatured: true, expiryReminderSentAt: true}});
    const byId = new Map(rows.map(r => [r.id, r]));
    expect(byId.get(past.id)!.status).toBe('expired');
    expect(byId.get(closed.id)!.status).toBe('closed');
    expect(byId.get(featured.id)!).toMatchObject({status: 'published', isFeatured: false});
    expect(byId.get(soon.id)!.expiryReminderSentAt).not.toBeNull();
    expect(byId.get(later.id)!.expiryReminderSentAt).toBeNull();
    // Published and unexpired: Soon, Later, the unfeatured one.
    expect((await db.company.findUniqueOrThrow({where: {id: co.id}})).activeJobCount).toBe(3);

    const logs = await db.emailLog.findMany({orderBy: {id: 'asc'}, select: {templateKey: true, to: true, status: true}});
    expect(logs).toEqual([
      {templateKey: 'job-expired', to: 'owner@example.com', status: 'skipped'},
      {templateKey: 'job-expiring', to: 'owner@example.com', status: 'skipped'},
    ]);

    const again = await runExpiry(db, URL_, now);
    expect(again.summary).toEqual({expired: 0, unfeatured: 0, reminded: 0});
    expect(await db.emailLog.count()).toBe(2);
  });

  it('claims reminders for companies without an owner, without emailing anyone', async () => {
    const co = await company();
    await job(co.id, {expiresAt: new Date(Date.now() + DAY)});
    expect((await runExpiry(db, URL_)).summary.reminded).toBe(1);
    expect(await db.emailLog.count()).toBe(0);
    expect((await runExpiry(db, URL_)).summary.reminded).toBe(0);
  });

  it('purges resumes past 180 days and keeps the application; a re-run is a no-op', async () => {
    const co = await company();
    const j = await job(co.id, {expiresAt: new Date(Date.now() + DAY)});
    const base = {jobId: j.id, name: 'Ana', consentAt: new Date(), consentText: 'ok'};
    const old = await db.application.create({
      data: {...base, email: 'old@example.com', resumeFileId: fileId(1), resumeFileName: 'cv.pdf', createdAt: new Date(Date.now() - 181 * DAY)},
    });
    const recent = await db.application.create({
      data: {...base, email: 'new@example.com', resumeFileId: fileId(2), resumeFileName: 'cv.pdf', createdAt: new Date(Date.now() - 179 * DAY)},
    });
    const broken = await db.application.create({
      data: {...base, email: 'fail@example.com', resumeFileId: fileId(3), resumeFileName: 'cv.pdf', createdAt: new Date(Date.now() - 200 * DAY)},
    });
    failDelete.add(fileId(3));
    await db.resumeUpload.create({data: {token: 't-attached', fileId: fileId(1), name: 'cv.pdf', contentType: 'application/pdf', size: 1, ready: true, applicationId: old.id}});
    await db.resumeUpload.create({data: {token: 't-stale', fileId: fileId(4), name: 'cv.pdf', contentType: 'application/pdf', size: 1, createdAt: new Date(Date.now() - 2 * DAY)}});
    await db.resumeUpload.create({data: {token: 't-fresh', fileId: fileId(5), name: 'cv.pdf', contentType: 'application/pdf', size: 1}});
    await db.boardAttempt.createMany({
      data: [
        {kind: 'apply', ipHash: 'a'.repeat(64), createdAt: new Date(Date.now() - 2 * DAY)},
        {kind: 'apply', ipHash: 'b'.repeat(64)},
      ],
    });

    const first = await runPurge(db, URL_);
    expect(first.summary).toEqual({resumesPurged: 1, resumesFailed: 1, uploadsSwept: 1, uploadsFailed: 0, attemptsSwept: 1});
    expect(deleted.sort()).toEqual([fileId(1), fileId(4)]);

    const apps = await db.application.findMany({orderBy: {id: 'asc'}, select: {id: true, resumeFileId: true, resumeFileName: true}});
    expect(apps).toEqual([
      {id: old.id, resumeFileId: null, resumeFileName: null},
      {id: recent.id, resumeFileId: fileId(2), resumeFileName: 'cv.pdf'},
      {id: broken.id, resumeFileId: fileId(3), resumeFileName: 'cv.pdf'},
    ]);
    expect((await db.resumeUpload.findMany({select: {token: true}})).map(u => u.token)).toEqual(['t-fresh']);
    expect(await db.boardAttempt.count()).toBe(1);

    // Storage is back: the failed one goes now; nothing else is touched again.
    failDelete.clear();
    deleted = [];
    const second = await runPurge(db, URL_);
    expect(second.summary).toMatchObject({resumesPurged: 1, uploadsSwept: 0, attemptsSwept: 0});
    expect(deleted).toEqual([fileId(3)]);
    deleted = [];
    expect((await runPurge(db, URL_)).summary).toEqual({resumesPurged: 0, resumesFailed: 0, uploadsSwept: 0, uploadsFailed: 0, attemptsSwept: 0});
    expect(deleted).toEqual([]);
    expect(await db.application.count()).toBe(3);
  });
});
