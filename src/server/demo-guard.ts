import {createMiddleware} from 'hono/factory';

import {getAccess} from '../platform/auth';
import {problem} from '../platform/guards';

/**
 * The store preview's demo admin (`prisma/demo-login.sql`, role `demo-read-only`) can LOOK but
 * never change anything (docs/agent/store-apps.md: "Every write refuses it"). Its role holds no
 * write permission, so every `requirePermission` route already says 403; this refuses the rest:
 * the writes that only need a signed-in account (becoming a job seeker or an employer, posting a
 * job, applying, a checkout, and the account's own password, email, two-step and delete, which
 * would lock every other preview visitor out of the shared demo).
 *
 * Only signing in and out stays open. Safe methods (GET, HEAD, OPTIONS) pass untouched, and so does
 * every request without a session: the role read runs only for a signed-in viewer's write (one
 * bounded query, shared with `requirePermission` within the request).
 */
export const DEMO_ROLE = 'demo-read-only';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The sign-in and sign-out writes the demo needs to get in and out. */
const OPEN = new Set(['/site-api/auth/login', '/site-api/auth/login/two-factor', '/site-api/auth/code', '/site-api/auth/code/verify', '/site-api/auth/refresh', '/site-api/auth/logout']);

export const refuseDemoWrites = createMiddleware(async (c, next) => {
  if (!SAFE.has(c.req.method) && !OPEN.has(c.req.path.replace(/\/+$/, ''))) {
    const access = await getAccess(c.req.raw).catch(() => null);
    // The roles could not be read (a database outage): the write could not go through anyway.
    if (!access) return c.json(problem('unavailable', 'The site is busy. Try again in a minute.'), 503, {'Retry-After': '60'});
    if (access.roles.includes(DEMO_ROLE)) {
      return c.json(problem('demo_read_only', 'This is a read-only demo: it can look around but not change anything.'), 403);
    }
  }
  await next();
});
