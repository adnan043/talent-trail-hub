import type {Context} from 'hono';

import type {Prisma, PrismaClient} from '../../generated/prisma/client';
import {type ApplicationStatus, RESUME_RETENTION_DAYS, isDbId} from '../../lib/board';
import {type ApplicantRow, RESUME_EXPIRED_TEXT} from '../../lib/types-apply';
import {can} from '../../platform/guards';
import type {Viewer} from '../../lib/types';
import {PERMISSIONS} from '../permissions';
import {sendBoardEmail} from './email';
import {cachedBoardSettings} from './brand';
import {type BoardSettings, isSingleCompany} from './settings';

/**
 * F16 applicants, shared by the employer area (own company) and the admin (`site:applicant:read`,
 * every company). Every read and write goes through a scope, so an employer never reaches another
 * company's job, application or resume: out-of-scope ids answer exactly like missing ones (404).
 */
export type ApplicantScope = {kind: 'all'} | {kind: 'company'; companyId: number} | {kind: 'none'};

type ViewerContext = Context<{Variables: {viewer: Viewer; db: PrismaClient}}>;

/**
 * `all` for holders of `site:applicant:read` (both board modes); otherwise the viewer's own
 * company, but only on a marketplace board (single-company mode: the employer area is 404).
 */
export async function applicantScope(c: ViewerContext): Promise<ApplicantScope> {
  if (await can(c as unknown as Context<{Variables: {viewer: Viewer}}>, PERMISSIONS.APPLICANT_READ_ALL)) return {kind: 'all'};
  const db = c.var.db;
  const [settings, company] = await Promise.all([
    cachedBoardSettings(db),
    db.company.findUnique({where: {ownerUserId: c.var.viewer.id!}, select: {id: true}}),
  ]);
  if (isSingleCompany(settings) || !company) return {kind: 'none'};
  return {kind: 'company', companyId: company.id};
}

/** The `jobs` filter of a scope (`null`: nothing is in scope). */
export function jobWhereOf(scope: ApplicantScope): Prisma.JobWhereInput | null {
  if (scope.kind === 'none') return null;
  return scope.kind === 'company' ? {companyId: scope.companyId} : {};
}

const DAY_MS = 86_400_000;

/** Applications created before this have no resume any more (F36), purged or not. */
export const retentionCutoff = (now = new Date()) => new Date(now.getTime() - RESUME_RETENTION_DAYS * DAY_MS);
export const isResumeExpired = (appliedAt: Date, now = new Date()) => appliedAt < retentionCutoff(now);

export const applicationSelect = {
  id: true,
  jobId: true,
  name: true,
  email: true,
  phone: true,
  profileUrl: true,
  coverNote: true,
  status: true,
  employerNotes: true,
  resumeFileId: true,
  resumeFileName: true,
  createdAt: true,
} as const;

export const adminApplicationSelect = {
  ...applicationSelect,
  job: {select: {id: true, title: true, slug: true, company: {select: {name: true}}}},
} as const;

type ApplicationRecord = Prisma.ApplicationGetPayload<{select: typeof applicationSelect}>;
type AdminApplicationRecord = Prisma.ApplicationGetPayload<{select: typeof adminApplicationSelect}>;

/** The row the screens see, field by field. Expired resumes lose their name. */
export function toApplicantRow(a: ApplicationRecord | AdminApplicationRecord, now = new Date()): ApplicantRow {
  const resumeExpired = isResumeExpired(a.createdAt, now);
  const row: ApplicantRow = {
    id: a.id,
    jobId: a.jobId,
    name: a.name,
    email: a.email,
    phone: a.phone,
    profileUrl: a.profileUrl,
    coverNote: a.coverNote,
    status: a.status as ApplicationStatus,
    notes: a.employerNotes ?? '',
    resumeFileName: a.resumeFileId && !resumeExpired ? (a.resumeFileName ?? 'Resume') : null,
    resumeExpired,
    appliedAt: a.createdAt.toISOString(),
  };
  if ('job' in a) row.job = {id: a.job.id, title: a.job.title, slug: a.job.slug, company: a.job.company.name};
  return row;
}

const CSV_COLUMNS = ['Name', 'Email', 'Phone', 'Profile URL', 'Status', 'Applied', 'Cover note', 'Notes', 'Resume'];
const JOB_COLUMNS = ['Job', 'Company'];

/** A CSV cell: quoted, and text a spreadsheet would run as a formula is defused. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * F16 CSV: the application's fields only, never files or links. "Resume" is the file name, or
 * the retention text once expired. `withJob` adds the job and company (the admin's list).
 */
export function applicantsCsv(rows: ApplicantRow[], {withJob = false} = {}): string {
  return csvHeader(withJob) + csvLines(rows, withJob);
}

export const csvHeader = (withJob: boolean) => `${[...CSV_COLUMNS, ...(withJob ? JOB_COLUMNS : [])].map(csvCell).join(',')}\r\n`;

/** Rows only (no header), each line ending CRLF: an export builds them batch by batch. */
export function csvLines(rows: ApplicantRow[], withJob: boolean): string {
  const lines: string[] = [];
  for (const r of rows) {
    const resume = r.resumeExpired ? RESUME_EXPIRED_TEXT : (r.resumeFileName ?? '');
    const cells = [r.name, r.email, r.phone ?? '', r.profileUrl ?? '', r.status, r.appliedAt.slice(0, 10), r.coverNote ?? '', r.notes, resume];
    if (withJob) cells.push(r.job?.title ?? '', r.job?.company ?? '');
    lines.push(`${cells.map(csvCell).join(',')}\r\n`);
  }
  return lines.join('');
}

/** `attachment` with an ASCII fallback (no quotes, CR or LF) and the UTF-8 name (RFC 6266). */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Candidate emails per status: `new` and `reviewed` send nothing. */
export const STATUS_TEMPLATES = {
  shortlisted: 'application-shortlisted',
  rejected: 'application-rejected',
} as const;

/** Positive safe integer from a path or query value, else null. */
export function idOf(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return isDbId(n) ? n : null;
}

/**
 * The candidate's confirmation and the employer's "new applicant" email (each send never throws).
 * Runs AFTER the apply answer (`after()`, src/server/board/after.ts). `settings`: the board
 * settings the route already holds, so no send reads them again.
 */
export async function notifyNewApplication(
  c: Context,
  db: PrismaClient,
  {job, candidate, boardName, singleCompany, settings}: {
    singleCompany: boolean;
    job: {id: number; title: string; slug: string; company: {name: string; ownerUserId: number | null}};
    candidate: {name: string; email: string};
    boardName: string;
    settings?: Pick<BoardSettings, 'name' | 'boardMode' | 'ownerCompanyId'>;
  }
) {
  const origin = new URL(c.req.url).origin;
  const requestUrl = c.req.url;
  // The employer; on a single-company board, or for a company without an owner account, the staff.
  const recipients = async () => {
    const owner =
      !singleCompany && job.company.ownerUserId
        ? await db.user.findFirst({where: {id: job.company.ownerUserId, status: 'active'}, select: {email: true}})
        : null;
    return {owner: owner !== null, to: owner ? [owner.email] : await applicantStaffEmails(db)};
  };
  // All at once: the confirmation, and the employer lookup followed by their emails.
  await Promise.allSettled([
    sendBoardEmail(
      db,
      requestUrl,
      {
        template: 'application-confirmation',
        to: candidate.email,
        vars: {boardName, applicantName: candidate.name, jobTitle: job.title, companyName: job.company.name, jobUrl: `${origin}/jobs/${job.slug}/`},
      },
      settings
    ),
    recipients().then(({owner, to}) => {
      const applicantsUrl = owner ? `${origin}/dashboard/employer/jobs/${job.id}/applicants` : `${origin}/dashboard/manage/applicants?job=${job.id}`;
      return Promise.allSettled(
        to.map(address =>
          sendBoardEmail(db, requestUrl, {template: 'new-applicant', to: address, vars: {boardName, jobTitle: job.title, applicantName: candidate.name, applicantsUrl}}, settings)
        )
      );
    }),
  ]);
}

/** Codenames that grant `site:applicant:read` (itself or a wildcard over it). */
const APPLICANT_READ_GRANTS = [PERMISSIONS.APPLICANT_READ_ALL, 'site:applicant:*', 'site:*', '*'];
const STAFF_EMAIL_MAX = 20;

/** Active users whose roles grant `site:applicant:read`, oldest first, at most 20. */
async function applicantStaffEmails(db: PrismaClient): Promise<string[]> {
  const users = await db.user.findMany({
    where: {status: 'active', roles: {some: {role: {permissions: {some: {permission: {codename: {in: APPLICANT_READ_GRANTS}}}}}}}},
    select: {email: true},
    orderBy: {id: 'asc'},
    take: STAFF_EMAIL_MAX,
  });
  return users.map(u => u.email);
}
