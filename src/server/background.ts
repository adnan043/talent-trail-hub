import {audit} from '../platform/auth';
import {defineBackground, DontRetry} from '../platform/background';
import {config} from '../platform/config';
import {getDb} from '../platform/db';
import {runExpiry, runPurge, type TaskResult} from './board/tasks';

/**
 * This site's BACKGROUND JOBS: one handler per list (docs/agent/background-jobs.md).
 *
 *   send:      sendJob(c.req.url, 'booking-reminders', {bookingId}, {at, key: `remind-${id}`, label})
 *   schedule:  background.json  {"schedules": {"daily-summary": {"every": "day", "at": "07:00", "tz": "Europe/London"}}}
 *
 * A handler gets the job's data (JSON) and returns when done. Throw to try again later;
 * throw `DontRetry` (from ../platform/background) when trying again cannot help. It may run more
 * than once: make it safe to repeat. Load what you need by id from the Site Database here; never
 * put a whole record (or a secret) in the data.
 *
 * The board's schedules (background.json): `board-expiry` hourly (jobs and featured flags past
 * their date, the 3-days-before reminder), `board-purge` daily at 03:30 UTC (resumes past the
 * retention period, stale uploads, old rate-limit rows). Both are idempotent (src/server/board/tasks.ts).
 */

/** A job has no visitor request: links in emails and platform calls use the site's own address. */
function siteUrl(): string {
  if (!config.siteUrl) throw new DontRetry('The site address (SITE_URL) is not set.');
  return config.siteUrl;
}

async function runTask(action: string, task: typeof runExpiry): Promise<TaskResult> {
  const db = getDb();
  if (!db) throw new Error('The Site Database is off.'); // tried again later
  const result = await task(db, siteUrl());
  if (Object.values(result.summary).some(n => n > 0)) {
    await audit(db, {actorUserId: null, action, target: ['task', action], meta: {...result.summary, source: 'schedule'}});
  }
  return result;
}

export const background = defineBackground({
  'board-expiry': () => runTask('task.expire_jobs', runExpiry),
  'board-purge': () => runTask('task.purge_resumes', runPurge),
});
