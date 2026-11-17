import {createMiddleware} from 'hono/factory';

import {config} from '../platform/config';
import {getDb} from '../platform/db';
import {ACCESS_COOKIE, cookieName, readCookie} from '../platform/auth/cookies';
import {verifyAccessToken} from '../platform/auth/jwt';
import {deleteFile} from './files';
import {dropProfileFile} from './board/applicant-profile';

/**
 * Deleting an account deletes its job seeker profile too: the phone, birth date, address, photo
 * and CV are personal data that must not outlive the account. The managed auth kit
 * (src/platform/auth/) deletes the `users` row only, so this runs on `POST /auth/delete-account`,
 * AFTER the kit has answered 200. The applications already sent stay with the employers, as
 * before (their CV file is kept until the retention purge, while an application still uses it).
 */
export const dropApplicantProfileOnDelete = createMiddleware(async (c, next) => {
  // Who is asking, read BEFORE the kit clears the session.
  const secret = config.jwtSecret;
  const token = readCookie(c.req.header('cookie'), cookieName(ACCESS_COOKIE, c.req.url));
  const verified = secret && token ? await verifyAccessToken(secret, token) : null;
  const userId = verified?.ok ? Number(verified.claims.sub) : NaN;
  await next();
  const db = getDb();
  if (c.req.method !== 'POST' || c.res.status !== 200 || !db || !Number.isSafeInteger(userId)) return;
  const gone = await db.applicantProfile.findUnique({where: {userId}, select: {photoFileId: true, resumeFileId: true}});
  if (!gone) return;
  await db.applicantProfile.delete({where: {userId}, select: {userId: true}});
  // Best effort: a file left behind is private and unreachable (nothing points at it any more).
  if (gone.photoFileId) await deleteFile(c.req.url, gone.photoFileId).catch(() => undefined);
  await dropProfileFile(db, c.req.url, gone.resumeFileId);
});
