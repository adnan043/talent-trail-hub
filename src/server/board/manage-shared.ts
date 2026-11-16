import type {Context} from 'hono';

import type {PrismaClient} from '../../generated/prisma/client';
import {EMPLOYER_SOURCES, type JobStatus} from '../../lib/board';
import type {AdminJobActions} from '../../lib/types-manage';
import {SiteKeyMissing} from '../../platform/api';
import {randomBytes, toBase64Url} from '../../platform/auth/encoding';
import {deleteFile} from '../../platform/files';
import {problem} from '../../platform/guards';
import type {Viewer} from '../../platform/types';
import {ipHashOf} from './ip';
import {errorLabel} from '../error-label';

/** Small pieces every admin route shares (workstream D). */

export const DAY_MS = 86_400_000;

/** A job's status as people see it: published past its expiry reads `expired`. */
export function effectiveStatus(job: {status: string; expiresAt: Date | null}, now = new Date()): JobStatus {
  if (job.status === 'published' && job.expiresAt && job.expiresAt <= now) return 'expired';
  return job.status as JobStatus;
}

/** A positive integer route param, or null. */
export function idParam(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** The body as an object (never an array or a primitive). */
export const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const invalid = (c: Context, fields: Record<string, string>, message = 'Check the highlighted fields.') =>
  c.json({...problem('invalid_input', message), fields}, 422);

export const notFound = (c: Context, message = 'No such job.') => c.json(problem('not_found', message), 404);

/** Who acted, for `audit()`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function actorOf(c: Context<any>) {
  const viewer = c.get('viewer') as Viewer | undefined;
  return {actorUserId: viewer?.id ?? null, ipHash: await ipHashOf(c)};
}

/** The site's public origin for links in emails (the request's own address). */
export const originOf = (requestUrl: string) => new URL(requestUrl).origin;

/**
 * `companies.active_job_count` (the companies directory lists > 0): recomputed for one company
 * after an admin write changed one of its jobs. Indexed (`company_id, status`), bounded.
 */
export async function refreshActiveJobCount(db: PrismaClient, companyId: number, now = new Date()): Promise<void> {
  try {
    // ONE statement, the same as the employer side's (employer.ts) and the expiry task's (tasks.ts).
    await db.$executeRaw`
      UPDATE "companies" c SET "active_job_count" = (
        SELECT count(*)::int FROM "jobs" j
        WHERE j."company_id" = c."id" AND j."status" = 'published' AND j."expires_at" > ${now}
      ), "updated_at" = now()
      WHERE c."id" = ${companyId}`;
  } catch (err) {
    console.warn(`active job count for company ${companyId}: ${errorLabel(err)}`);
  }
}

/** The employer's address (company owner), or null for admin / import companies. */
export async function employerEmail(db: PrismaClient, ownerUserId: number | null): Promise<string | null> {
  if (!ownerUserId) return null;
  const user = await db.user.findUnique({where: {id: ownerUserId}, select: {email: true, status: true}});
  return user && user.status === 'active' ? user.email : null;
}

export type PlatformAnswer<T> = {ok: true; data: T} | {ok: false; status: number; code: string; message: string};

/**
 * A platform helper's answer, never a throw: no Site Key on this machine, a malformed file id or
 * an outage all become an `{ok: false}` with words for people.
 */
export async function tryPlatform<T>(run: () => Promise<PlatformAnswer<T>>): Promise<PlatformAnswer<T>> {
  try {
    return await run();
  } catch (err) {
    const missing = err instanceof SiteKeyMissing;
    return {
      ok: false,
      status: 0,
      code: missing ? 'E_SITE_KEY_MISSING' : 'E_PLATFORM',
      message: missing ? 'This site has no Site Key here, so the platform cannot be reached.' : 'The platform did not answer. Try again.',
    };
  }
}

export const isEmployerJob = (source: string) => (EMPLOYER_SOURCES as readonly string[]).includes(source);

export const isFeaturedNow = (job: {isFeatured: boolean; featuredUntil: Date | null}, now: Date) =>
  job.isFeatured && (job.featuredUntil === null || job.featuredUntil > now);

export function actionsFor(status: JobStatus, source: string): AdminJobActions {
  return {
    feature: status === 'published',
    extend: status === 'published' || status === 'expired' || status === 'closed',
    close: status === 'published' || status === 'pending_review',
    edit: !isEmployerJob(source),
  };
}


const FILE_CHUNK = 10;
/** The date a handed-over upload row gets: long past the purge's one-day wait. */
const LONG_AGO = new Date(0);

/**
 * Call in the SAME transaction that deletes these applications, before it does: their resume files
 * are handed to the nightly purge (`runPurge`, src/server/board/tasks.ts), which deletes the file of
 * every upload row with no application older than a day, and retries the next night when storage
 * fails. Each upload row is detached (no application, no file name, no IP) and dated long ago; a
 * file with no row gets one. So a file this request cannot delete (storage down, the time budget
 * spent) is never left behind, although the application pointing at it is gone.
 */
export async function handFilesToPurge(t: PrismaClient, applicationIds: number[], fileIds: string[]): Promise<void> {
  if (!applicationIds.length) return;
  await t.resumeUpload.updateMany({
    where: {applicationId: {in: applicationIds}},
    data: {applicationId: null, name: 'deleted', ipHash: null, createdAt: LONG_AGO},
  });
  if (!fileIds.length) return;
  await t.resumeUpload.createMany({
    data: fileIds.map(fileId => ({
      token: toBase64Url(randomBytes(32)),
      fileId,
      name: 'deleted',
      contentType: 'application/octet-stream',
      size: 0,
      ready: true,
      createdAt: LONG_AGO,
    })),
    skipDuplicates: true,
  });
}

/**
 * Deletes files handed over by `handFilesToPurge` ~10 at a time in parallel (a file already gone
 * counts as deleted), then their upload rows. Past `deadline` the rest are left for the nightly
 * purge, as are the ones storage refused. Answers how many are left.
 */
export async function deleteStoredFiles(db: PrismaClient, requestUrl: string, fileIds: string[], deadline = Infinity): Promise<number> {
  const deleted: string[] = [];
  let i = 0;
  for (; i < fileIds.length && Date.now() <= deadline; i += FILE_CHUNK) {
    const chunk = fileIds.slice(i, i + FILE_CHUNK);
    const results = await Promise.allSettled(chunk.map(id => tryPlatform(() => deleteFile(requestUrl, id))));
    results.forEach((r, k) => {
      if (r.status === 'fulfilled' && (r.value.ok || r.value.status === 404)) deleted.push(chunk[k]!);
    });
  }
  if (deleted.length) await db.resumeUpload.deleteMany({where: {fileId: {in: deleted}, applicationId: null}});
  return fileIds.length - deleted.length;
}
