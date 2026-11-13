import type {PrismaClient} from '../../generated/prisma/client';
import {config} from '../../platform/config';
import {absoluteLinks, renderEmail} from './emails/render';
import {TEMPLATES} from './emails/templates';
import {cachedBoardSettings} from './brand';
import {type BoardSettings, isSingleCompany} from './settings';
import {errorLabel} from '../error-label';

/**
 * The board's own emails (not the platform's account emails, which only cover sign-in).
 * Every call writes an `email_logs` row: `sent`, `failed`, or `skipped` when no mail service
 * is set up. Never throws: the caller's answer to the visitor must not depend on it.
 *
 * Templates (src/server/board/emails/): job-submitted, job-approved, job-rejected,
 * job-expiring, job-expired, new-applicant, application-confirmation,
 * application-shortlisted, application-rejected, admin-job-review, order-receipt.
 *
 * Sending: Resend's HTTP API, when the owner added the `RESEND_API_KEY` secret (live: the
 * production secret; Preview: the staging one). The sender is the `EMAIL_FROM` secret
 * (`Board <jobs@your-domain>`, a domain verified in Resend); without it, Resend's shared test
 * sender `onboarding@resend.dev`, which only delivers to the Resend account's own address.
 * Links: `…Url` values that are site paths (`/jobs/x/`) become absolute on the request's origin.
 */
export type BoardEmailTemplate =
  | 'job-submitted'
  | 'job-approved'
  | 'job-rejected'
  | 'job-expiring'
  | 'job-expired'
  | 'new-applicant'
  | 'application-confirmation'
  | 'application-shortlisted'
  | 'application-rejected'
  | 'admin-job-review'
  | 'order-receipt';

export interface BoardEmail {
  template: BoardEmailTemplate;
  to: string;
  /** Values for the template (`{{jobTitle}}`): plain text, escaped by the renderer. */
  vars: Record<string, string>;
}

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'onboarding@resend.dev';
const TIMEOUT_MS = 8000;
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
/** `Name <a@b.c>` or `a@b.c`, one line. */
const FROM = /^(?:[^\r\n<>]{1,80} <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

type Outcome = {status: 'sent' | 'failed' | 'skipped'; error: string | null};

/** A mail service's error text may quote addresses: never log or store them. */
const redact = (text: string) => text.replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[email]');

async function deliver(apiKey: string, to: string, message: {subject: string; text: string; html: string}): Promise<Outcome> {
  const fromSecret = config.ownerSecret('EMAIL_FROM');
  const from = fromSecret && FROM.test(fromSecret.trim()) ? fromSecret.trim() : DEFAULT_FROM;
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {authorization: `Bearer ${apiKey}`, 'content-type': 'application/json'},
      body: JSON.stringify({from, to: [to], subject: message.subject, text: message.text, html: message.html}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === 'TimeoutError';
    return {status: 'failed', error: timedOut ? 'The mail service did not answer in time.' : 'The mail service could not be reached.'};
  }
  const answer = (await res.json().catch(() => null)) as {id?: unknown; message?: unknown} | null;
  if (res.ok && typeof answer?.id === 'string') return {status: 'sent', error: null};
  const why = typeof answer?.message === 'string' ? `: ${redact(answer.message.replace(/\s+/g, ' ')).slice(0, 200)}` : '';
  return {status: 'failed', error: `The mail service answered ${res.status}${why}`};
}

/**
 * Sends one board email and logs it. `settings`: the board settings the caller already holds (the
 * board's name, the single-company mode); without them, the cached copy (brand.ts), never a query.
 */
export async function sendBoardEmail(
  db: PrismaClient,
  requestUrl: string,
  email: BoardEmail,
  settings?: Pick<BoardSettings, 'name' | 'boardMode' | 'ownerCompanyId'>
): Promise<void> {
  const to = String(email.to ?? '').trim().slice(0, 254);
  let outcome: Outcome;
  try {
    const template = TEMPLATES[email.template];
    if (!template) outcome = {status: 'failed', error: 'Unknown email template.'};
    else if (!EMAIL.test(to)) outcome = {status: 'failed', error: 'The recipient is not an email address.'};
    else {
      const apiKey = config.ownerSecret('RESEND_API_KEY');
      if (!apiKey) outcome = {status: 'skipped', error: 'No mail service: add the RESEND_API_KEY secret.'};
      else {
        const given = email.vars ?? {};
        const board = settings ?? (await cachedBoardSettings(db));
        const boardName = given.boardName || board.name;
        // The employer area is hidden on a single-company board: its links go to the home page.
        const single = isSingleCompany(board);
        const links = single
          ? Object.fromEntries(Object.entries(given).map(([k, v]) => [k, k.endsWith('Url') && v.startsWith('/dashboard/employer') ? '/' : v]))
          : given;
        const vars = absoluteLinks({...links, boardName}, new URL(requestUrl).origin);
        outcome = await deliver(apiKey, to, renderEmail(template, vars));
      }
    }
  } catch (err) {
    outcome = {status: 'failed', error: `Could not send: ${redact(String((err as Error)?.message ?? err)).slice(0, 200)}`};
  }
  if (outcome.status === 'failed') console.warn(`board email ${email.template} failed: ${outcome.error}`);
  try {
    await db.emailLog.create({
      data: {templateKey: String(email.template).slice(0, 40), to, status: outcome.status, error: outcome.error?.slice(0, 500) ?? null},
      select: {id: true},
    });
  } catch (err) {
    console.warn(`board email ${email.template}: the log row was not written (${errorLabel(err)})`);
  }
}
