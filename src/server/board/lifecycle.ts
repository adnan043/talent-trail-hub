import type {PrismaClient} from '../../generated/prisma/client';
import {getBoardSettings} from './settings';

/**
 * A job's way onto the board, shared by every area: the employer's paid / free post
 * (payments hook, workstream C), the admin's approve and free admin posts (D), renewals.
 * One place, so expiry and featured dates are computed the same way everywhere.
 */

const DAY_MS = 86_400_000;

/**
 * Where a submitted employer job goes: straight live (`auto` mode only; no company skips review), or
 * into the review queue. `first_post` is reserved (Release 2) and treated as `all`.
 */
export async function submissionTarget(db: PrismaClient, _companyId: number): Promise<'published' | 'pending_review'> {
  const settings = await getBoardSettings(db);
  return settings.moderationMode === 'auto' ? 'published' : 'pending_review';
}

/**
 * Puts a job live NOW: `publishedAt` and `expiresAt` from its `durationDays`, featured for the whole
 * listing when its tier included it. A job that was already live (an approved EDIT) keeps its
 * dates (`keepDates`). Conditional on the current status, so a double call (a retried payment
 * event and the thanks page's confirm) publishes once: answers whether THIS call did it.
 */
export async function publishJob(
  db: PrismaClient,
  jobId: number,
  options: {from: string[]; keepDates?: boolean; now?: Date} = {from: ['pending_payment', 'pending_review', 'draft']}
): Promise<boolean> {
  const now = options.now ?? new Date();
  const job = await db.job.findUnique({
    where: {id: jobId},
    select: {durationDays: true, listingFeatured: true, publishedAt: true, expiresAt: true},
  });
  if (!job) return false;
  const keep = options.keepDates && job.publishedAt && job.expiresAt && job.expiresAt > now;
  const expiresAt = keep ? job.expiresAt! : new Date(now.getTime() + job.durationDays * DAY_MS);
  const {count} = await db.job.updateMany({
    where: {id: jobId, status: {in: options.from}},
    data: {
      status: 'published',
      publishedAt: keep ? job.publishedAt! : now,
      expiresAt,
      rejectionReason: null,
      // A new listing period gets its own expiry reminder.
      ...(keep ? {} : {expiryReminderSentAt: null}),
      ...(job.listingFeatured && !keep ? {isFeatured: true, featuredUntil: expiresAt} : {}),
    },
  });
  return count === 1;
}
