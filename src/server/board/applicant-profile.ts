import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS, RESUME_TYPES} from '../../lib/board';
import {type AccountKind, type ApplicantProfileView, type Gender, PHOTO_TYPES} from '../../lib/types-profile';
import {SiteKeyMissing} from '../../platform/api';
import {config} from '../../platform/config';
import {completeUpload, createUpload, deleteFile} from '../files';
import {firstBytes, looksLikeResume} from './applicants-resume';
import {isLogoImage} from './employer-logo';

/**
 * A job seeker's profile (`applicant_profiles`): what kind an account is, the profile as the
 * Site API answers it, and its two PRIVATE files (photo, CV). The bytes go from the browser straight
 * to storage, so each file is checked after the upload by its first bytes, as the company logo and
 * the old resume upload are. An upload is bound to the account by a keyed token: a file id learned
 * elsewhere can never be claimed.
 *
 * The CV is SHARED: each application made with it points at the same file (the platform has no
 * copy). So a CV file is deleted only once neither the profile nor any application still uses it
 * (`fileInUse`), here, in the nightly purge and in the privacy tool.
 */

export type ProfileFileKind = 'photo' | 'resume';

/** Photo and CV uploads per user per hour (`board_attempts`). */
export const PROFILE_UPLOADS_PER_HOUR = 30;

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

async function tokenFor(userId: number, kind: ProfileFileKind, fileId: string): Promise<string> {
  const secret = config.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(`applicant-file:${secret}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}:${kind}:${fileId}`)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** What this account is. ONE round trip: two indexed EXISTS (the profile's key, the company's unique owner). */
export async function accountKind(db: PrismaClient, userId: number): Promise<AccountKind> {
  const [row] = await db.$queryRaw<{applicant: boolean; employer: boolean}[]>`
    SELECT EXISTS (SELECT 1 FROM "applicant_profiles" WHERE "user_id" = ${userId}) AS "applicant",
           EXISTS (SELECT 1 FROM "companies" WHERE "owner_user_id" = ${userId}) AS "employer"`;
  if (row?.applicant) return 'applicant';
  return row?.employer ? 'employer' : 'none';
}

export const profileSelect = {
  phone: true,
  dateOfBirth: true,
  gender: true,
  presentAddress: true,
  permanentAddress: true,
  headline: true,
  careerSummary: true,
  experienceYears: true,
  expectedSalary: true,
  degree: true,
  institute: true,
  passingYear: true,
  skills: true,
  profileUrl: true,
  photoFileId: true,
  resumeFileName: true,
  resumeFileId: true,
  resumeUpdatedAt: true,
  updatedAt: true,
} as const;

type ProfileRow = {
  phone: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  headline: string | null;
  careerSummary: string | null;
  experienceYears: number | null;
  expectedSalary: string | null;
  degree: string | null;
  institute: string | null;
  passingYear: number | null;
  skills: string | null;
  profileUrl: string | null;
  photoFileId: string | null;
  resumeFileName: string | null;
  resumeFileId: string | null;
  resumeUpdatedAt: Date | null;
  updatedAt: Date;
};

/** The answer's shape, field by field (never a file id). */
export function toProfileView(row: ProfileRow, account: {name: string; email: string}): ApplicantProfileView {
  return {
    name: account.name,
    email: account.email,
    phone: row.phone,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: (row.gender as Gender | null) ?? null,
    presentAddress: row.presentAddress,
    permanentAddress: row.permanentAddress,
    headline: row.headline,
    careerSummary: row.careerSummary,
    experienceYears: row.experienceYears,
    expectedSalary: row.expectedSalary,
    degree: row.degree,
    institute: row.institute,
    passingYear: row.passingYear,
    skills: row.skills,
    profileUrl: row.profileUrl,
    hasPhoto: row.photoFileId !== null,
    // The file id's tail: changes with the file, says nothing on its own.
    photoVersion: row.photoFileId ? row.photoFileId.slice(-8) : null,
    resumeFileName: row.resumeFileId ? row.resumeFileName : null,
    resumeUpdatedAt: row.resumeUpdatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Is `fileId` still used by a profile or an application (other than those named)? Two indexed
 * lookups (`resume_file_id` on both tables).
 */
export async function fileInUse(db: PrismaClient, fileId: string, except: {applicationIds?: number[]; profileUserId?: number} = {}): Promise<boolean> {
  const [app, profile] = await Promise.all([
    db.application.findFirst({
      where: {resumeFileId: fileId, ...(except.applicationIds?.length ? {id: {notIn: except.applicationIds}} : {})},
      select: {id: true},
    }),
    db.applicantProfile.findFirst({
      where: {resumeFileId: fileId, ...(except.profileUserId ? {userId: {not: except.profileUserId}} : {})},
      select: {userId: true},
    }),
  ]);
  return app !== null || profile !== null;
}

export type FileProblem = {status: 400 | 402 | 422 | 503; code: string; message: string};

const unavailable = (err: unknown): FileProblem => ({
  status: 503,
  code: 'storage_unavailable',
  message: err instanceof SiteKeyMissing ? 'File uploads are not set up on this site yet.' : 'Storage did not answer. Try again.',
});

const fromPlatform = (r: {status: number; code: string; message: string}): FileProblem => ({
  status: r.status === 402 ? 402 : r.status === 0 ? 503 : 400,
  code: r.code.toLowerCase(),
  message: r.message,
});

const RULES: Record<ProfileFileKind, {types: readonly string[]; maxBytes: number; message: string}> = {
  photo: {types: PHOTO_TYPES, maxBytes: LIMITS.photoMb * 1024 * 1024, message: `Use a PNG, JPG or WebP photo up to ${LIMITS.photoMb} MB.`},
  resume: {types: RESUME_TYPES, maxBytes: LIMITS.resumeMb * 1024 * 1024, message: `Upload your CV as a PDF or DOCX file up to ${LIMITS.resumeMb} MB.`},
};

/** This kind's own limits, before any storage call. */
export function checkFileInput(kind: ProfileFileKind, input: {name: string; contentType: string; size: number}): string | null {
  const rule = RULES[kind];
  if (!input.name || !rule.types.includes(input.contentType) || input.size < 1 || input.size > rule.maxBytes) return rule.message;
  return null;
}

/** Step 1: a one-time PRIVATE upload URL and the token that binds it to this account. */
export async function startProfileUpload(
  requestUrl: string,
  userId: number,
  kind: ProfileFileKind,
  input: {name: string; contentType: string; size: number}
): Promise<{ok: true; fileId: string; token: string; upload: unknown} | ({ok: false} & FileProblem)> {
  try {
    const grant = await createUpload(requestUrl, {...input, visibility: 'private'});
    if (!grant.ok) return {ok: false, ...fromPlatform(grant)};
    const fileId = grant.data.file.id;
    return {ok: true, fileId, token: await tokenFor(userId, kind, fileId), upload: grant.data.upload};
  } catch (err) {
    return {ok: false, ...unavailable(err)};
  }
}

/** Step 3: confirm, then check what was really stored. A refused file is deleted. */
export async function finishProfileUpload(
  requestUrl: string,
  userId: number,
  kind: ProfileFileKind,
  fileId: string,
  token: string
): Promise<{ok: true; fileId: string; name: string} | ({ok: false} & FileProblem)> {
  if (!/^file_[0-9a-z]{26}$/.test(fileId) || !/^[0-9a-f]{64}$/.test(token) || !same(token, await tokenFor(userId, kind, fileId))) {
    return {ok: false, status: 422, code: 'invalid_input', message: 'That upload is not yours. Choose the file again.'};
  }
  const rule = RULES[kind];
  try {
    const done = await completeUpload(requestUrl, fileId);
    if (!done.ok) return {ok: false, ...fromPlatform(done)};
    const file = done.data;
    const typed = rule.types.includes(file.contentType) && file.visibility === 'private' && file.size <= rule.maxBytes;
    const bytes = typed ? await firstBytes(requestUrl, fileId) : null;
    const real = bytes !== null && (kind === 'photo' ? isLogoImage(bytes) : looksLikeResume(file.contentType, bytes));
    if (!real) {
      await deleteFile(requestUrl, fileId).catch(() => undefined);
      return {ok: false, status: 422, code: kind === 'photo' ? 'invalid_photo' : 'invalid_resume', message: rule.message};
    }
    return {ok: true, fileId, name: file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(-200)};
  } catch (err) {
    return {ok: false, ...unavailable(err)};
  }
}

/** Deletes a replaced file, unless something still uses it; a failure only leaves an unused private file. */
export async function dropProfileFile(db: PrismaClient, requestUrl: string, fileId: string | null): Promise<void> {
  if (!fileId) return;
  try {
    if (await fileInUse(db, fileId)) return;
    await deleteFile(requestUrl, fileId);
  } catch (err) {
    console.warn(`applicant file not removed: ${(err as Error).name}`);
  }
}
