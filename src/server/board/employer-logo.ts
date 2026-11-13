import type {PrismaClient} from '../../generated/prisma/client';
import {LIMITS} from '../../lib/board';
import {SiteKeyMissing} from '../../platform/api';
import {config} from '../../platform/config';
import {completeUpload, createUpload, deleteFile, fileUrl, publicFileUrl} from '../../platform/files';
import {errorLabel} from '../error-label';

/**
 * A company logo (F17): PNG, JPEG or WebP up to 1 MB, a PUBLIC file (docs/agent/files.md). The
 * bytes go from the browser straight to storage, so the server checks them after the upload: it
 * reads the file's first bytes back and refuses anything that is not really one of those images
 * (an SVG or HTML renamed `.png`). The upload is bound to the company by a keyed token, so a file
 * id learned elsewhere (another company's logo) can never be claimed.
 */

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = LIMITS.logoMb * 1024 * 1024;
const encoder = new TextEncoder();

export type LogoProblem = {status: 400 | 402 | 422 | 503; code: string; message: string};

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

async function keyed(message: string): Promise<string> {
  const secret = config.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(`company-logo:${secret}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

const tokenFor = (companyId: number, fileId: string) => keyed(`${companyId}:${fileId}`);

/** Logo uploads per user per hour (`board_attempts`, keyed hash of the user id; swept daily). */
export const LOGO_UPLOADS_PER_HOUR = 30;

/** Counts this attempt; false when the user already made `LOGO_UPLOADS_PER_HOUR` in the last hour. */
export async function logoAttemptAllowed(db: PrismaClient, userId: number): Promise<boolean> {
  const ipHash = await keyed(`user:${userId}`);
  const since = new Date(Date.now() - 3_600_000);
  // Record FIRST, then look: parallel bursts all see each other. Bounded read on the
  // (kind, ip_hash, created_at) index: at most one row past the limit.
  await db.boardAttempt.create({data: {kind: 'logo', ipHash}, select: {id: true}});
  const recent = await db.boardAttempt.findMany({
    where: {kind: 'logo', ipHash, createdAt: {gt: since}},
    select: {id: true},
    take: LOGO_UPLOADS_PER_HOUR + 1,
  });
  return recent.length <= LOGO_UPLOADS_PER_HOUR;
}

/** Constant-time compare of two hex strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The first bytes say PNG, JPEG or WebP. */
export function isLogoImage(bytes: Uint8Array): boolean {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  const webp = bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return png || jpeg || webp;
}

const unavailable = (err: unknown): LogoProblem => ({
  status: 503,
  code: 'storage_unavailable',
  message: err instanceof SiteKeyMissing ? 'File storage is not set up on this site yet.' : 'Storage did not answer. Try again.',
});

const fromPlatform = (r: {status: number; code: string; message: string}): LogoProblem => ({
  status: r.status === 402 ? 402 : r.status === 0 ? 503 : 400,
  code: r.code.toLowerCase(),
  message: r.message,
});

/** Step 1: an upload URL for a logo the browser has already checked. */
export async function startLogoUpload(
  requestUrl: string,
  companyId: number,
  input: {name: string; contentType: string; size: number}
): Promise<{ok: true; fileId: string; token: string; upload: unknown} | ({ok: false} & LogoProblem)> {
  try {
    const grant = await createUpload(requestUrl, {...input, visibility: 'public'});
    if (!grant.ok) return {ok: false, ...fromPlatform(grant)};
    const fileId = grant.data.file.id;
    return {ok: true, fileId, token: await tokenFor(companyId, fileId), upload: grant.data.upload};
  } catch (err) {
    return {ok: false, ...unavailable(err)};
  }
}

async function firstBytes(requestUrl: string, fileId: string): Promise<Uint8Array | null> {
  const link = await fileUrl(requestUrl, fileId, {expiresIn: 60});
  if (!link.ok) return null;
  try {
    const res = await fetch(link.data.url, {headers: {range: 'bytes=0-15'}, signal: AbortSignal.timeout(8000)});
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const {value} = await reader.read();
    await reader.cancel().catch(() => undefined);
    return value ?? null;
  } catch {
    return null;
  }
}

/** Step 3: confirm, check what was stored, answer the public link. A refused file is deleted. */
export async function finishLogoUpload(
  requestUrl: string,
  companyId: number,
  fileId: string,
  token: string
): Promise<{ok: true; fileId: string; url: string} | ({ok: false} & LogoProblem)> {
  if (!/^file_[0-9a-z]{26}$/.test(fileId) || !same(token, await tokenFor(companyId, fileId))) {
    return {ok: false, status: 422, code: 'invalid_input', message: 'That upload is not yours. Choose the image again.'};
  }
  try {
    const done = await completeUpload(requestUrl, fileId);
    if (!done.ok) return {ok: false, ...fromPlatform(done)};
    const file = done.data;
    const typed = (LOGO_TYPES as readonly string[]).includes(file.contentType) && file.visibility === 'public' && file.size <= MAX_BYTES;
    const bytes = typed ? await firstBytes(requestUrl, fileId) : null;
    if (!bytes || !isLogoImage(bytes)) {
      await deleteFile(requestUrl, fileId).catch(() => undefined);
      return {ok: false, status: 422, code: 'invalid_logo', message: `Use a PNG, JPG or WebP image up to ${LIMITS.logoMb} MB.`};
    }
    return {ok: true, fileId, url: publicFileUrl(file)};
  } catch (err) {
    return {ok: false, ...unavailable(err)};
  }
}

/** Removes a replaced logo's file; a failure only leaves an unused public file. */
export async function dropLogoFile(requestUrl: string, fileId: string | null): Promise<void> {
  if (!fileId) return;
  try {
    await deleteFile(requestUrl, fileId);
  } catch (err) {
    console.warn(`company logo ${fileId} not deleted: ${errorLabel(err)}`);
  }
}

export const LOGO_MAX_BYTES = MAX_BYTES;
