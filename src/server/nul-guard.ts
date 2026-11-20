import {createMiddleware} from 'hono/factory';

import {problem} from '../platform/guards';

/**
 * Refuses a NUL character (U+0000) in the query string or in any string of a JSON body, before a
 * route sees it. Postgres text cannot hold one, so it reached the database as an error (Prisma
 * P2039) and every route answered 500: the public job and company searches (`?q=%00`), sign-in
 * (`{"email":"a\u0000@b.co"}`), applicant notes, the company profile and the privacy lookup.
 * Anyone could raise an error alert at will. No real input needs the character: a 400 like any
 * other unreadable input.
 *
 * The body is read from a CLONE (64 KB at most: `bodyLimit` runs first), so the route and the
 * managed auth routes read the original untouched. A body that is not JSON passes here; the route
 * answers it as it always does. Every write's body is checked whatever its `Content-Type` says,
 * as `authEmailGuard` does (the JSON validator also parses `application/<anything>+json`).
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function hasNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 20 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => hasNul(item, depth + 1));
  return Object.entries(value).some(([key, item]) => key.includes('\u0000') || hasNul(item, depth + 1));
}

const refused = () => problem('invalid_input', 'That request could not be read.');

export const refuseNulBytes = createMiddleware(async (c, next) => {
  const query = new URL(c.req.url).search;
  if (query && /%00/.test(query)) return c.json(refused(), 400);
  if (!SAFE.has(c.req.method)) {
    const text = await c.req.raw
      .clone()
      .text()
      .catch(() => '');
    // Only a body that could hold one is parsed (a raw NUL, or JSON's escaped `\u0000`).
    if (text.includes('\u0000')) return c.json(refused(), 400);
    if (/\\u0000/i.test(text)) {
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (hasNul(body)) return c.json(refused(), 400);
    }
  }
  await next();
});
