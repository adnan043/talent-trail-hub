import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {HTTPException} from 'hono/http-exception';

import {isPreview} from '../platform/api';
import {adminRoutes, authRoutes, getAccess, getViewer} from '../platform/auth';
import {config} from '../platform/config';
import {csrf, previewCookies, problem, sameOrigin} from '../platform/guards';
import {syncPermissions} from '../platform/permission-sync';
import {authEmailGuard} from './auth-email-guard';
import {authSettings} from './auth-settings';
import {signOutOthersOnTwoFactor} from './two-factor-signout';
import {dropApplicantProfileOnDelete} from './applicant-account-delete';
import {refuseDemoWrites} from './demo-guard';
import {refuseNulBytes} from './nul-guard';
import {checkoutRoutes, membershipRoutes} from './routes/checkout';
import {abilitiesFor, CATALOGUE} from './permissions';
import {applicationRoutes} from './routes/applications';
import {boardRoutes} from './routes/board';
import {companyRoutes} from './routes/companies';
import {employerRoutes} from './routes/employer';
import {jobRoutes} from './routes/jobs';
import {manageRoutes} from './routes/manage';
import {myApplicationRoutes} from './routes/my-applications';
import {applicantProfileRoutes} from './routes/applicant-profile';
import {accountKind} from './board/applicant-profile';
import {cachedBoardSettings} from './board/brand';
import {isSingleCompany} from './board/settings';
import {getDb} from '../platform/db';
import {localFileRoutes} from './files';
import {siteRoutes} from './routes/site';

/**
 * The Site API: this site's ONLY backend, one Hono app at `/site-api/*`.
 *
 * Everything reads and writes through it: the Astro pages call it IN-PROCESS
 * (`src/server/backend.ts`), the portal and the `/account` pages call it from
 * the browser (`siteFetch` / the typed `hc` client, `src/portal/api.ts`).
 * Mounted by ONE catch-all page, `src/pages/site-api/[...path].ts`.
 *
 *   GET  /health        what this site has been given (booleans only)
 *   GET  /me            the visitor + what the UI may show them
 *   *    /auth/...      sign-up, sign-in, sessions, passwords   platform/auth/routes.ts
 *   *    /admin/...     users, roles, audit log (admins)        platform/auth/admin.ts
 *   GET  /site          the site's brand                        routes/site.ts
 *   *    /jobs/...      public jobs: search, detail             routes/jobs.ts
 *   *    /companies/... public companies                         routes/companies.ts
 *   *    /board/...     board settings, brand, categories, tiers routes/board.ts
 *   *    /applications/... apply (signed-in applicants), applicants  routes/applications.ts
 *   GET  /my-applications  the signed-in candidate's own applications  routes/my-applications.ts
 *   *    /applicant-profile/... the job seeker's own profile, photo and CV  routes/applicant-profile.ts
 *   *    /employer/...  the employer area (own company only)    routes/employer.ts
 *   *    /manage/...    the board's admin (codenames)           routes/manage.ts
 *   *    /checkout/...  start and confirm a payment             routes/checkout.ts
 *   *    /memberships/... the member's memberships               routes/checkout.ts
 *
 * Add a feature as a new `routes/<name>.ts` and one `.route()` line below,
 * CHAINED so `AppType` carries every route to the typed client. Errors are
 * JSON `{error, message}`. `sameOrigin` + `csrf` refuse every cross-site or
 * token-less write; keep them, with `previewCookies` before them (a webhook
 * that must accept a cross-site write gets its own app, mounted before them,
 * with its own authentication).
 */
export const app = new Hono()
  .basePath('/site-api')
  // The editor Preview only: auth cookies carried in headers (its gateway drops cookies).
  .use(previewCookies)
  .use(sameOrigin)
  // The store preview's read-only demo admin: every write but signing in and out refuses it.
  .use(refuseDemoWrites)
  // The Buy button posts here as a plain form too (no JavaScript): BEFORE `csrf`, with its own
  // `formCsrf` (the token, or a same-origin form post). Keep it here (docs/agent/payments.md).
  .route('/checkout', checkoutRoutes)
  // LOCAL DEVELOPMENT ONLY (404 elsewhere): photo/CV bytes with no file storage; a signed URL,
  // so before `csrf` and the body limit, as the storage's own upload URL is (src/server/files.ts).
  .route('/local-files', localFileRoutes)
  .use(csrf)
  // No route here takes a big body; uploads never pass through the Worker.
  .use(bodyLimit({maxSize: 64 * 1024, onError: c => c.json(problem('too_large', 'That request is too large.'), 413)}))
  // A NUL character (Postgres text cannot hold one) is a 400 here, never a database error and a 500.
  .use(refuseNulBytes)
  // New catalogue codenames reach the `permissions` table (once per isolate; no migration).
  .use(syncPermissions(CATALOGUE))

  .get('/health', c =>
    c.json({
      ok: true,
      preview: isPreview(),
      database: Boolean(config.databaseUrl),
      auth: Boolean(config.jwtSecret && config.databaseUrl),
      siteKey: Boolean(config.siteKey),
    })
  )

  // `abilities` only decides what the UI SHOWS; every guarded route checks again.
  .get('/me', async c => {
    const db = getDb();
    const viewerRead = getViewer(c.req.raw);
    const [viewer, access, settings, kind] = await Promise.all([
      viewerRead,
      getAccess(c.req.raw),
      // Bounded: a slow database never holds up every portal load (the flag falls back to marketplace).
      db
        ? Promise.race([cachedBoardSettings(db).catch(() => null), new Promise<null>(resolve => setTimeout(resolve, 1500, null))])
        : null,
      // Applicant, company or neither: which part of the dashboard this account sees.
      viewerRead.then(v => (db && v.state === 'user' && v.id ? accountKind(db, v.id).catch(() => 'none' as const) : ('none' as const))),
    ]);
    c.header('Cache-Control', 'private, no-store');
    // One flag per catalogue entry with an `ability` (src/server/permissions.ts).
    const abilities = abilitiesFor(new Set(access.permissions));
    // Single-company mode hides the employer area (pages and API answer 404 there too).
    const board = {singleCompany: settings ? isSingleCompany(settings) : false};
    return c.json({viewer, roles: access.roles, abilities, board, account: {kind}});
  })

  // Before the auth routes: an `email` shaped like one of the kit's internal limit keys is refused.
  .use('/auth/*', authEmailGuard)
  // Turning on two-step sign-in signs out every other device (after the kit answers).
  .use('/auth/two-factor/enable', signOutOthersOnTwoFactor)
  // Deleting an account deletes its job seeker profile, photo and CV (after the kit answers).
  .use('/auth/delete-account', dropApplicantProfileOnDelete)
  .route('/auth', authRoutes(authSettings))
  .route('/admin', adminRoutes)
  .route('/site', siteRoutes)
  .route('/jobs', jobRoutes)
  .route('/companies', companyRoutes)
  .route('/board', boardRoutes)
  .route('/applications', applicationRoutes)
  .route('/my-applications', myApplicationRoutes)
  .route('/applicant-profile', applicantProfileRoutes)
  .route('/employer', employerRoutes)
  .route('/manage', manageRoutes)
  .route('/memberships', membershipRoutes)

  .notFound(c => c.json(problem('not_found', 'No such Site API route.'), 404))
  .onError((err, c) => {
    // A request Hono itself refused (a JSON body that does not parse): the CLIENT's mistake, a 4xx
    // like any other bad input. Never a 500 (an error alert) that anyone can trigger at will.
    if (err instanceof HTTPException && err.status >= 400 && err.status < 500) {
      return c.json(problem('invalid_input', 'That request could not be read.'), err.status as 400);
    }
    // Never the message: a Prisma error's message prints the call's arguments (an applicant's
    // name, email, phone). The error's name and code are enough to find it.
    const code = (err as {code?: unknown}).code;
    console.error(`site-api ${c.req.method} ${c.req.path}: ${err.name}${typeof code === 'string' ? ` ${code}` : ''}`);
    return c.json(problem('internal_error', 'Something went wrong.'), 500);
  });

export type AppType = typeof app;
