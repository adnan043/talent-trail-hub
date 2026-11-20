import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {app} from '../../src/server/app';
import {parseJobSearch} from '../../src/lib/job-search';
import {Browser, configureEnv, DATABASE_URL, db, RawBody, resetDatabase, signedIn} from './support/harness';

/**
 * Security check 10: a NUL character (Postgres text cannot hold one) reached the database and
 * every route answered 500, the public searches and sign-in included: an error alert anyone could
 * raise at will. Now a 400 before any route (src/server/nul-guard.ts).
 */
describe('job search text', () => {
  it('turns control characters into spaces', () => {
    expect(parseJobSearch(new URLSearchParams('q=%00design%01x')).q).toBe('design x');
  });
});

describe.skipIf(!DATABASE_URL)('NUL characters (integration, real Postgres)', () => {
  beforeAll(() => configureEnv());
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('refuses one in a query string with a 400, never a 500', async () => {
    const visitor = new Browser(app);
    for (const path of ['/site-api/jobs?q=%00', '/site-api/companies?q=a%00b', '/site-api/jobs?location=%00']) {
      const res = await visitor.get(path);
      expect(res.status, path).toBe(400);
      expect(res.json.error, path).toBe('invalid_input');
    }
    expect((await visitor.get('/site-api/jobs?q=design')).status).toBe(200);
  });

  it('refuses one anywhere in a JSON body, whatever the content type', async () => {
    const visitor = new Browser(app);
    const login = await visitor.post('/site-api/auth/login', {email: 'a\u0000@example.test', password: 'a long test passphrase'});
    expect(login.status).toBe(400);
    const typed = await visitor.request('POST', '/site-api/auth/login', {email: 'a\u0000@example.test', password: 'x'}, {'content-type': 'application/x+json'});
    expect(typed.status).toBe(400);

    const seeker = await signedIn(app, 'seeker@example.test');
    expect((await seeker.post('/site-api/applicant-profile/start')).status).toBe(200);
    const nested = await seeker.request('PUT', '/site-api/applicant-profile', {details: {headline: ['ok', 'b\u0000ad']}});
    expect(nested.status).toBe(400);
    // The six characters `\u0000` typed as text are fine (an escaped backslash), and so is a body that is not JSON.
    const literal = await seeker.request('POST', '/site-api/auth/login', new RawBody('{"email":"a\\\\u0000@example.test","password":"x"}'));
    expect(literal.status).not.toBe(400);
    const notJson = await seeker.request('POST', '/site-api/auth/login', new RawBody('not json'));
    expect(notJson.status).not.toBe(500);
  });

  it('refuses one nested deeper than the check walks (security check 11)', async () => {
    const visitor = new Browser(app);
    let deep: unknown = 'a\u0000b';
    for (let i = 0; i < 30; i++) deep = {x: deep};
    const res = await visitor.post('/site-api/auth/login', {email: 'a@example.test', password: 'x', deep});
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_input');
    // As deep, without one: not the guard's business.
    let plain: unknown = 'ab';
    for (let i = 0; i < 30; i++) plain = {x: plain};
    expect((await visitor.post('/site-api/auth/login', {email: 'a@example.test', password: 'x', plain})).status).not.toBe(400);
  });
});
