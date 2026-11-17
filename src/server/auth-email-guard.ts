import {createMiddleware} from 'hono/factory';

import {problem} from '../platform/guards';

/**
 * Refuses, before the auth routes see it, an `email` that could pass for one of the auth kit's
 * INTERNAL rate-limit keys. The kit (managed, src/platform/auth/) builds those keys by adding text
 * to the address (`<email>|device`, `signup:<email>`, `unconfirmed:<email>`) and hashes them in
 * the same space as plain addresses, while its email check accepts `|` and `:`. So a stranger who
 * types `victim@gmail.com|device` as an "address" spends the victim's own limits (their trusted
 * browser locked out of code sign-in, their sign-up or mail budget used up).
 *
 * No real address needs `|` or `:` (`:` only inside a quoted local part, which the kit never
 * accepts anyway), so such an address gets the same answer as any other malformed one.
 * Remove this once the template keeps each key in its own hash domain.
 *
 * EVERY write's body is read, whatever its `Content-Type` says: the routes' JSON validator also
 * parses `application/<anything>+json` (and any letter case), so a guard that looked only for
 * `application/json` was walked around with `Content-Type: application/x+json`. A body that is not
 * JSON passes here untouched; the route then answers it as it always does.
 */
const RESERVED = /[|:]/;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const authEmailGuard = createMiddleware(async (c, next) => {
  if (!SAFE.has(c.req.method)) {
    // Hono keeps the parsed body, so the route's own validator reads the same value after this.
    const body = (await c.req.json().catch(() => null)) as unknown;
    const email = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).email : undefined;
    if (typeof email === 'string' && RESERVED.test(email)) {
      const message = 'Enter a valid email address, like name@example.com.';
      return c.json({...problem('invalid_input', message), fields: {email: message}}, 422);
    }
  }
  await next();
});
