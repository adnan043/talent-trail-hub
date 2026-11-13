import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';

import {isPreview} from '../platform/api';
import {adminRoutes, authRoutes, getAccess, getViewer} from '../platform/auth';
import {config} from '../platform/config';
import {csrf, previewCookies, problem, sameOrigin} from '../platform/guards';
import {syncPermissions} from '../platform/permission-sync';
import {authSettings} from './auth-settings';
import {checkoutRoutes, membershipRoutes} from './routes/checkout';
import {abilitiesFor, CATALOGUE} from './permissions';
import {applicationRoutes} from './routes/applications';
import {boardRoutes} from './routes/board';
import {companyRoutes} from './routes/companies';
import {employerRoutes} from './routes/employer';
import {jobRoutes} from './routes/jobs';
import {manageRoutes} from './routes/manage';
import {getBoardSettings, isSingleCompany} from './board/settings';
import {getDb} from '../platform/db';
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
 *   *    /applications/... apply without an account, resumes   routes/applications.ts
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
  // The Buy button posts here as a plain form too (no JavaScript): BEFORE `csrf`, with its own
  // `formCsrf` (the token, or a same-origin form post). Keep it here (docs/agent/payments.md).
  .route('/checkout', checkoutRoutes)
  .use(csrf)
  // No route here takes a big body; uploads never pass through the Worker.
  .use(bodyLimit({maxSize: 64 * 1024, onError: c => c.json(problem('too_large', 'That request is too large.'), 413)}))
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
    const [viewer, access, settings] = await Promise.all([
      getViewer(c.req.raw),
      getAccess(c.req.raw),
      // Bounded: a slow database never holds up every portal load (the flag falls back to marketplace).
      db
        ? Promise.race([getBoardSettings(db).catch(() => null), new Promise<null>(resolve => setTimeout(resolve, 1500, null))])
        : null,
    ]);
    c.header('Cache-Control', 'private, no-store');
    // One flag per catalogue entry with an `ability` (src/server/permissions.ts).
    const abilities = abilitiesFor(new Set(access.permissions));
    // Single-company mode hides the employer area (pages and API answer 404 there too).
    const board = {singleCompany: settings ? isSingleCompany(settings) : false};
    return c.json({viewer, roles: access.roles, abilities, board});
  })

  .route('/auth', authRoutes(authSettings))
  .route('/admin', adminRoutes)
  .route('/site', siteRoutes)
  .route('/jobs', jobRoutes)
  .route('/companies', companyRoutes)
  .route('/board', boardRoutes)
  .route('/applications', applicationRoutes)
  .route('/employer', employerRoutes)
  .route('/manage', manageRoutes)
  .route('/memberships', membershipRoutes)

  .notFound(c => c.json(problem('not_found', 'No such Site API route.'), 404))
  .onError((err, c) => {
    // Never the message: a Prisma error's message prints the call's arguments (an applicant's
    // name, email, phone). The error's name and code are enough to find it.
    const code = (err as {code?: unknown}).code;
    console.error(`site-api ${c.req.method} ${c.req.path}: ${err.name}${typeof code === 'string' ? ` ${code}` : ''}`);
    return c.json(problem('internal_error', 'Something went wrong.'), 500);
  });

export type AppType = typeof app;
