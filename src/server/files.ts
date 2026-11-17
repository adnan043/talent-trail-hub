import {Hono} from 'hono';

import {config} from '../platform/config';
import {getDb} from '../platform/db';
import * as platform from '../platform/files';
import type {FileResult, StoredFile, UploadGrant} from '../platform/files';
import {problem} from '../platform/guards';

/**
 * The private files of applicant accounts (photo, CV): the platform's file storage
 * (`src/platform/files.ts`), with the same calls and answers. On your OWN machine there is no Site
 * Key, so there is no storage: in local development mode (`config.localDev`, never on a hosted
 * site, never in a build) the bytes go to the `local_dev_files` table instead, through
 * `/site-api/local-files/<id>` (upload URL and short-lived link, both signed). Anywhere else
 * that route answers 404 and every call goes to the platform as before.
 */

const FILE_ID = /^file_[0-9a-z]{26}$/;
const ROUTE = '/site-api/local-files/';
/** The largest local file: above the CV limit (5 MB), well under a sane bytea row. */
const LOCAL_MAX_BYTES = 10 * 1024 * 1024;

const local = () => config.localDev;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

async function sign(message: string): Promise<string> {
  const secret = config.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(`local-dev-file:${secret}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return `file_${[...bytes].map(b => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('')}`;
}

function db() {
  const client = getDb();
  if (!client) throw new Error('No Site Database.');
  return client;
}

const missing = <T>(): FileResult<T> => ({ok: false, status: 404, code: 'E_NOT_FOUND', message: 'That file is not there.'});

type Row = {id: string; name: string; contentType: string; size: number; createdAt: Date};
const stored = (row: Row, ready: boolean): StoredFile => ({
  id: row.id,
  name: row.name,
  contentType: row.contentType,
  size: row.size,
  visibility: 'private',
  status: ready ? 'ready' : 'pending',
  environment: 'staging',
  createdAt: row.createdAt.toISOString(),
  completedAt: ready ? row.createdAt.toISOString() : null,
});

const meta = {id: true, name: true, contentType: true, size: true, createdAt: true} as const;

/** Step 1: a one-time upload URL (locally: this site's own `/site-api/local-files/<id>`). */
export async function createUpload(
  requestUrl: string | URL,
  input: {name: string; contentType: string; size: number; visibility?: 'private' | 'public'}
): Promise<FileResult<UploadGrant>> {
  if (!local()) return platform.createUpload(requestUrl, input);
  if (input.size < 1 || input.size > LOCAL_MAX_BYTES) return {ok: false, status: 400, code: 'E_FILE_TOO_LARGE', message: 'That file is too large.'};
  const row = await db().localDevFile.create({
    data: {id: newId(), name: input.name.slice(-200), contentType: input.contentType, size: input.size},
    select: meta,
  });
  const expires = Date.now() + 15 * 60_000;
  const sig = await sign(`put:${row.id}:${expires}`);
  const file = stored(row, false);
  return {
    ok: true,
    data: {
      file,
      upload: {
        method: 'PUT',
        url: `${new URL(requestUrl).origin}${ROUTE}${row.id}?e=${expires}&s=${sig}`,
        headers: {'content-type': input.contentType},
        expiresAt: new Date(expires).toISOString(),
        direct: true,
        file,
      },
    },
  };
}

/** Step 3: the file is there once its bytes are. */
export async function completeUpload(requestUrl: string | URL, id: string): Promise<FileResult<StoredFile>> {
  if (!local()) return platform.completeUpload(requestUrl, id);
  const [row] = await db().$queryRaw<(Row & {hasData: boolean})[]>`
    SELECT "id", "name", "content_type" AS "contentType", "size", "created_at" AS "createdAt", "data" IS NOT NULL AS "hasData"
    FROM "local_dev_files" WHERE "id" = ${id}`;
  if (!row) return missing();
  if (!row.hasData) return {ok: false, status: 409, code: 'E_UPLOAD_INCOMPLETE', message: 'The upload did not finish. Try again.'};
  return {ok: true, data: stored(row, true)};
}

/** A link that stops working after `expiresIn` seconds. */
export async function fileUrl(
  requestUrl: string | URL,
  id: string,
  options: {expiresIn?: number; download?: boolean} = {}
): Promise<FileResult<{url: string; expiresAt: string}>> {
  if (!local()) return platform.fileUrl(requestUrl, id, options);
  if (!FILE_ID.test(id)) throw new Error('Not a file id.');
  const expires = Date.now() + (options.expiresIn ?? 3600) * 1000;
  const dl = options.download ? 1 : 0;
  const sig = await sign(`get:${id}:${expires}:${dl}`);
  return {
    ok: true,
    data: {url: `${new URL(requestUrl).origin}${ROUTE}${id}?e=${expires}&d=${dl}&s=${sig}`, expiresAt: new Date(expires).toISOString()},
  };
}

export async function deleteFile(requestUrl: string | URL, id: string): Promise<FileResult<{deleted: true}>> {
  if (!local()) return platform.deleteFile(requestUrl, id);
  await db().localDevFile.deleteMany({where: {id}});
  return {ok: true, data: {deleted: true}};
}

/** The file's first 16 bytes (the type check after an upload), or null. */
export async function firstBytes(requestUrl: string, fileId: string): Promise<Uint8Array | null> {
  if (local()) {
    const [row] = await db().$queryRaw<{head: Uint8Array | null}[]>`
      SELECT substring("data" from 1 for 16) AS "head" FROM "local_dev_files" WHERE "id" = ${fileId}`;
    return row?.head ? new Uint8Array(row.head) : null;
  }
  const link = await platform.fileUrl(requestUrl, fileId, {expiresIn: 60});
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

const expired = (e: string | undefined) => !e || !/^\d{13}$/.test(e) || Number(e) < Date.now();

/**
 * `/site-api/local-files/:id`: the upload (PUT) and the link (GET) of local development mode.
 * Mounted BEFORE `csrf` and the 64 KB body limit (the bytes come here); the signed URL is the
 * authorization, exactly as the storage's own signed URL is. 404 anywhere but local development.
 */
export const localFileRoutes = new Hono()
  .use('*', async (c, next) => (local() ? next() : c.json(problem('not_found', 'Not found.'), 404)))
  .put('/:id', async c => {
    const id = c.req.param('id');
    const {e, s} = c.req.query();
    if (!FILE_ID.test(id) || expired(e) || !s || !same(s, await sign(`put:${id}:${e}`))) return c.text('Forbidden', 403);
    const row = await db().localDevFile.findUnique({where: {id}, select: {contentType: true, size: true}});
    if (!row || c.req.header('content-type') !== row.contentType) return c.text('Forbidden', 403);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    // Signed for exactly this size and type, as the storage is.
    if (bytes.length !== row.size) return c.text('Forbidden', 403);
    const {count} = await db().localDevFile.updateMany({where: {id, data: null}, data: {data: bytes}});
    return count ? c.body(null, 200) : c.text('Forbidden', 403);
  })
  .get('/:id', async c => {
    const id = c.req.param('id');
    const {e, d, s} = c.req.query();
    const dl = d === '1' ? 1 : 0;
    if (!FILE_ID.test(id) || expired(e) || !s || !same(s, await sign(`get:${id}:${e}:${dl}`))) return c.text('Forbidden', 403);
    const row = await db().localDevFile.findUnique({where: {id}, select: {name: true, contentType: true, data: true}});
    if (!row?.data) return c.text('Not found', 404);
    const name = row.name.replace(/[^\w.\- ]/g, '_');
    return c.body(new Uint8Array(row.data), 200, {
      'content-type': row.contentType,
      'content-disposition': `${dl ? 'attachment' : 'inline'}; filename="${name}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
  });
