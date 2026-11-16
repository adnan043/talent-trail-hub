import type {PrismaClient} from '../../generated/prisma/client';
import {PERMISSIONS} from '../permissions';
import {sendBoardEmail} from './email';
import {getBoardSettings} from './settings';
import {errorLabel} from '../error-label';

/** At most this many moderators get the email (a board has a handful of admins). */
const MAX_REVIEWERS = 50;

/** Every codename that grants `site:job:moderate`: itself and its wildcard parents. */
function grantingCodenames(codename: string): string[] {
  const parts = codename.split(':');
  const out = [codename, '*'];
  for (let i = parts.length - 1; i > 0; i--) out.push(`${parts.slice(0, i).join(':')}:*`);
  return out;
}

/** The active, confirmed accounts whose roles grant `site:job:moderate` (owners hold `*`). */
export async function reviewerEmails(db: PrismaClient): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      status: 'active',
      emailVerifiedAt: {not: null},
      roles: {some: {role: {permissions: {some: {permission: {codename: {in: grantingCodenames(PERMISSIONS.JOB_MODERATE)}}}}}}},
    },
    select: {email: true},
    orderBy: {id: 'asc'},
    take: MAX_REVIEWERS,
  });
  return users.map(u => u.email);
}

/**
 * Tells every moderator (holders of `site:job:moderate`) that a job entered the review queue:
 * one `admin-job-review` email each, each time. Called by the employer flow (C) after a submit
 * or an edit that needs review. Only the title and company name go out. Never throws: it runs
 * after a payment or an edit committed, whose answer must not depend on it.
 */
export async function notifyReviewers(db: PrismaClient, requestUrl: string, jobId: number): Promise<void> {
  try {
    const job = await db.job.findUnique({
      where: {id: jobId},
      select: {id: true, title: true, status: true, company: {select: {name: true}}},
    });
    if (!job || job.status !== 'pending_review') return;
    const [emails, settings] = await Promise.all([reviewerEmails(db), getBoardSettings(db)]);
    const vars = {
      boardName: settings.name,
      jobTitle: job.title,
      companyName: job.company.name,
      reviewUrl: `${new URL(requestUrl).origin}/dashboard/manage/moderation/${job.id}`,
    };
    // In parallel: this runs inside the payment confirm and edit paths.
    await Promise.allSettled(emails.map(to => sendBoardEmail(db, requestUrl, {template: 'admin-job-review', to, vars})));
  } catch (err) {
    console.error(`review alert for job ${jobId}: ${errorLabel(err)}`);
  }
}
