import {createMiddleware} from 'hono/factory';

import {config} from '../platform/config';
import {getDb} from '../platform/db';
import {audit} from '../platform/auth';
import {ACCESS_COOKIE, cookieName, readCookie} from '../platform/auth/cookies';
import {verifyAccessToken} from '../platform/auth/jwt';

/**
 * Turning on two-step sign-in signs out every OTHER device. Someone who turns it on because they
 * think their password leaked must not leave a stranger's open session running for weeks. This
 * browser stays signed in.
 *
 * Mounted on `POST /auth/two-factor/enable` (the managed auth kit, src/platform/auth/, does not do
 * this itself). It runs only after the kit has answered 200. It revokes every refresh family of the
 * account except the one this request signed in with (the access token's `sid`). The session check
 * reads the family on every request, so those devices are signed out at once.
 * If this request's sign-in can't be read, nothing is revoked, so this browser is never signed out.
 */
export const signOutOthersOnTwoFactor = createMiddleware(async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status !== 200) return;
  const secret = config.jwtSecret;
  const db = getDb();
  const token = readCookie(c.req.header('cookie'), cookieName(ACCESS_COOKIE, c.req.url));
  if (!secret || !db || !token) return;
  const verified = await verifyAccessToken(secret, token);
  if (!verified.ok) return;
  const userId = Number(verified.claims.sub);
  const familyId = verified.claims.sid;
  if (!Number.isSafeInteger(userId) || !familyId) return;
  const {count} = await db.refreshToken.updateMany({
    where: {userId, revokedAt: null, familyId: {not: familyId}},
    data: {revokedAt: new Date(), revokedReason: 'device'},
  });
  if (count) await audit(db, {actorUserId: userId, action: 'other_sessions_ended', target: ['user', userId], meta: {reason: 'two_factor_enabled'}});
});
