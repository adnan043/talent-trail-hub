import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {CANDIDATE_DAILY, inboxOf, sendBoardEmail} from '../../src/server/board/email';
import {createWithUniqueSlug} from '../../src/server/board/slug';
import {env} from './support/cloudflare-workers';
import {configureEnv, DATABASE_URL, db, resetDatabase} from './support/harness';

/** Board emails are always logged (data integrity), and company / job slugs stay unique. */
const REQ = 'https://jobs.example.test/site-api/applications';

describe.skipIf(!DATABASE_URL)('board emails + slugs (integration, real Postgres)', () => {
  beforeAll(configureEnv);
  afterAll(() => db.$disconnect());
  beforeEach(resetDatabase);
  afterEach(() => {
    delete env.RESEND_API_KEY;
    delete env.EMAIL_FROM;
    vi.restoreAllMocks();
  });

  const logs = () => db.emailLog.findMany({orderBy: {id: 'asc'}, select: {templateKey: true, to: true, status: true, error: true}});

  it('logs skipped without a mail service, and calls nothing', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await sendBoardEmail(db, REQ, {template: 'job-approved', to: 'Emp@example.com', vars: {jobTitle: 'Designer'}});
    expect(spy).not.toHaveBeenCalled();
    // Lowercased in the log, so the privacy tool finds it by the normalized address.
    expect(await logs()).toEqual([
      {templateKey: 'job-approved', to: 'emp@example.com', status: 'skipped', error: expect.stringContaining('RESEND_API_KEY')},
    ]);
  });

  it('sends through Resend with escaped values and absolute links, and logs sent', async () => {
    env.RESEND_API_KEY = 're_test_key';
    env.EMAIL_FROM = 'Board <jobs@example.com>';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({id: 'em_1'}), {status: 200}));
    await sendBoardEmail(db, REQ, {
      template: 'application-confirmation',
      to: 'cand@example.com',
      vars: {applicantName: '<b>Ana</b>', jobTitle: 'Dev **x** <i>y</i>', companyName: 'Acme\r\nBcc: x@y.z', jobUrl: '/jobs/dev/'},
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer re_test_key');
    const body = JSON.parse(String(init!.body));
    expect(body.from).toBe('Board <jobs@example.com>');
    expect(body.to).toEqual(['cand@example.com']);
    expect(body.subject).toBe('Your application to Acme Bcc: x@y.z');
    // The visitor-typed name never reaches the (visitor-typed) address; other values are escaped.
    expect(body.html).not.toContain('Ana');
    expect(body.text).not.toContain('Ana');
    expect(body.html).toContain('<strong>Dev **x** &lt;i&gt;y&lt;/i&gt;</strong>');
    expect(body.html).toContain('<a href="https://jobs.example.test/jobs/dev/">View the job</a>');
    expect(body.html).toContain('Talent Trail Hub'); // the board name from the settings
    expect(body.text).toContain('View the job (https://jobs.example.test/jobs/dev/)');
    expect(await logs()).toEqual([{templateKey: 'application-confirmation', to: 'cand@example.com', status: 'sent', error: null}]);
  });

  it('a stranger’s address gets at most CANDIDATE_DAILY candidate emails a day, with no typed name', async () => {
    env.RESEND_API_KEY = 're_test_key';
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({id: 'em'}), {status: 200}));
    const send = (template: 'application-confirmation' | 'application-rejected', to = 'victim@example.com') =>
      sendBoardEmail(db, REQ, {template, to, vars: {applicantName: 'Buy pills', jobTitle: 'Dev', companyName: 'Acme'}});
    for (let i = 0; i < CANDIDATE_DAILY; i++) await send(i % 2 ? 'application-rejected' : 'application-confirmation');
    await send('application-rejected');
    await send('application-confirmation', 'someone-else@example.com');
    expect(spy).toHaveBeenCalledTimes(CANDIDATE_DAILY + 1);
    for (const [, init] of spy.mock.calls) expect(String(init!.body)).not.toContain('Buy pills');
    const rows = await logs();
    expect(rows.filter(r => r.to === 'victim@example.com' && r.status === 'sent')).toHaveLength(CANDIDATE_DAILY);
    expect(rows.at(-2)).toMatchObject({to: 'victim@example.com', status: 'skipped', error: expect.stringContaining('today')});
    expect(rows.at(-1)).toMatchObject({to: 'someone-else@example.com', status: 'sent'});
  });

  it('address variants of one inbox share its daily budget', async () => {
    expect(inboxOf('V.ic.Tim+jobs@GoogleMail.com')).toBe('victim@gmail.com');
    expect(inboxOf('victim+1@gmail.com.')).toBe('victim@gmail.com');
    expect(inboxOf('first.last+x@example.com')).toBe('first.last@example.com');
    env.RESEND_API_KEY = 're_test_key';
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({id: 'em'}), {status: 200}));
    for (let i = 0; i < CANDIDATE_DAILY + 5; i++) {
      const to = i % 2 ? `vic.tim+${i}@gmail.com` : `v.ictim${'+x'.repeat(i % 3)}@googlemail.com`;
      await sendBoardEmail(db, REQ, {template: 'application-confirmation', to, vars: {jobTitle: 'Dev', companyName: 'Acme'}});
    }
    expect(spy).toHaveBeenCalledTimes(CANDIDATE_DAILY);
  });

  it('logs failed (never throws) when Resend refuses or is unreachable', async () => {
    env.RESEND_API_KEY = 're_test_key';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({message: 'Domain not verified'}), {status: 403}))
      .mockRejectedValueOnce(new TypeError('network'));
    await sendBoardEmail(db, REQ, {template: 'job-expired', to: 'a@example.com', vars: {jobTitle: 'X', renewUrl: '/dashboard/'}});
    await sendBoardEmail(db, REQ, {template: 'job-expired', to: 'a@example.com', vars: {jobTitle: 'X'}});
    await sendBoardEmail(db, REQ, {template: 'job-expired', to: 'not-an-email', vars: {}});
    const rows = await logs();
    expect(rows.map(r => r.status)).toEqual(['failed', 'failed', 'failed']);
    expect(rows[0]!.error).toBe('The mail service answered 403: Domain not verified');
    expect(rows[1]!.error).toBe('The mail service could not be reached.');
    expect(rows[2]!.error).toBe('The recipient is not an email address.');
  });

  it('createWithUniqueSlug gives each company its own slug, also when two race', async () => {
    const make = (name: string) =>
      createWithUniqueSlug(
        name,
        async slug => (await db.company.findUnique({where: {slug}, select: {id: true}})) !== null,
        slug => db.company.create({data: {name, slug}, select: {slug: true}})
      );
    expect((await make('Acme Inc.')).slug).toBe('acme-inc');
    expect((await make('Acme Inc')).slug).toBe('acme-inc-2');
    expect((await make('ACME inc')).slug).toBe('acme-inc-3');
    // Concurrent creates of one name: the unique index + retry keeps them apart.
    const raced = await Promise.all([make('Beta'), make('Beta'), make('Beta')]);
    expect(new Set(raced.map(r => r.slug)).size).toBe(3);
    expect(raced.map(r => r.slug).sort()).toEqual(['beta', 'beta-2', 'beta-3']);
  });
});
