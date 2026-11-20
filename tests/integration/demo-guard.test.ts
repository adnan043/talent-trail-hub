import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {DEMO_ROLE} from '../../src/server/demo-guard';
import {Browser, configureEnv, DATABASE_URL, db, resetDatabase, signedIn, userId} from './support/harness';

/**
 * The store preview's read-only demo admin (prisma/demo-login.sql, docs/agent/store-apps.md):
 * it signs in and looks around, and EVERY write refuses it, the ones that only need a signed-in
 * account included (security check 9).
 */

const PASSWORD = 'a long test passphrase';

async function makeDemo(email: string) {
  const role = await db.role.upsert({
    where: {slug: DEMO_ROLE},
    update: {},
    create: {slug: DEMO_ROLE, name: 'Demo (read-only)', description: 'test', isSystem: false},
    select: {id: true},
  });
  await db.userRole.create({data: {userId: await userId(email), roleId: role.id}});
}

describe.skipIf(!DATABASE_URL)('read-only demo admin (integration, real Postgres)', () => {
  beforeAll(() => configureEnv());
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('signs in and reads, but every write refuses it', async () => {
    const first = await signedIn(app, 'demo@example.test', PASSWORD);
    await makeDemo('demo@example.test');
    expect((await first.post('/site-api/auth/logout')).status).toBe(200);

    // Signing in stays open.
    const demo = new Browser(app);
    const login = await demo.post('/site-api/auth/login', {email: 'demo@example.test', password: PASSWORD});
    expect(login.status).toBe(200);
    const me = await demo.get('/site-api/me');
    expect(me.status).toBe(200);
    expect(me.json.roles).toContain(DEMO_ROLE);

    const refused = [
      ['POST', '/site-api/applicant-profile/start', {}],
      ['POST', '/site-api/employer/post', {}],
      ['POST', '/site-api/auth/change-password', {currentPassword: PASSWORD, newPassword: 'another long passphrase'}],
      ['POST', '/site-api/auth/delete-account', {password: PASSWORD}],
      ['POST', '/site-api/auth/logout-all', {}],
      ['POST', '/site-api/checkout', {}],
    ] as const;
    for (const [method, path, body] of refused) {
      const res = await demo.request(method, path, body);
      expect(res.status, path).toBe(403);
      expect(res.json.error, path).toBe('demo_read_only');
    }
    // The job page's public POSTs (view counter, saved-jobs lookup) are not the demo's writes.
    for (const path of ['/site-api/jobs/saved', '/site-api/jobs/no-such-job/view']) {
      const res = await demo.request('POST', path, {ids: []});
      expect(res.json?.error, path).not.toBe('demo_read_only');
      expect(res.status, path).not.toBe(403);
    }
    // Nothing changed: still no job seeker profile, the account and its password stand.
    expect(await db.applicantProfile.count()).toBe(0);
    expect((await new Browser(app).post('/site-api/auth/login', {email: 'demo@example.test', password: PASSWORD})).status).toBe(200);

    // Signing out stays open too.
    expect((await demo.post('/site-api/auth/logout')).status).toBe(200);
  });

  it('leaves everyone else alone', async () => {
    const seeker = await signedIn(app, 'seeker@example.test', PASSWORD);
    const res = await seeker.post('/site-api/applicant-profile/start');
    expect(res.status).toBe(200);
    expect(res.json.kind).toBe('applicant');
  });
});
