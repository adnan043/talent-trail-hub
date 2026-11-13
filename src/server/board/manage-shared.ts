import type {Context} from 'hono';

import type {PrismaClient} from '../../generated/prisma/client';
import {EMPLOYER_SOURCES, type JobStatus} from '../../lib/board';
import type {AdminJobActions} from '../../lib/types-manage';
import {SiteKeyMissing} from '../../platform/api';
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

/**
 * Deletes stored files ~10 at a time in parallel; a file already gone counts as deleted. Past
 * `deadline` the rest are left (counted, logged by the caller): never more than the time budget.
 * Answers how many could not be deleted.
 */
export async function deleteStoredFiles(requestUrl: string, fileIds: string[], deadline = Infinity): Promise<number> {
  let left = 0;
  for (let i = 0; i < fileIds.length; i += FILE_CHUNK) {
    if (Date.now() > deadline) return left + fileIds.length - i;
    const results = await Promise.allSettled(fileIds.slice(i, i + FILE_CHUNK).map(id => tryPlatform(() => deleteFile(requestUrl, id))));
    for (const r of results) if (r.status === 'rejected' || (!r.value.ok && r.value.status !== 404)) left++;
  }
  return left;
}
