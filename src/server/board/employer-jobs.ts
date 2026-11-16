import {Prisma, type PrismaClient} from '../../generated/prisma/client';
import {type JobStatus, isDbId} from '../../lib/board';
import {checkJobValues, type JobColumns, jobColumns, type JobValues, jobValuesOf} from '../../lib/job-input';
import {renderMarkdown} from '../../lib/markdown';
import type {EmployerJobActions, EmployerJobDetail, EmployerJobRow} from '../../lib/types-employer';
import {createWithUniqueSlug} from './slug';

/**
 * The employer's jobs (F10 save, F15 list / edit / close). Every read and write is scoped to the
 * employer's own company (`companyId` from the session's company, never from the request): a job
 * of another company is "not found".
 */

const DAY_MS = 86_400_000;
/** Shown in "My jobs" (a wizard draft is not). */
const LISTED: JobStatus[] = ['pending_payment', 'pending_review', 'published', 'rejected', 'expired', 'closed'];
const EDITABLE: JobStatus[] = ['pending_review', 'published', 'expired', 'closed'];
export const RENEWABLE: JobStatus[] = ['published', 'expired', 'closed'];

/** A published job past its expiry is expired, even before the expiry job has run. */
export const effectiveStatus = (job: {status: string; expiresAt: Date | null}, now = new Date()): JobStatus =>
  (job.status === 'published' && job.expiresAt !== null && job.expiresAt <= now ? 'expired' : job.status) as JobStatus;

export const jobActions = (status: JobStatus): EmployerJobActions => ({
  edit: EDITABLE.includes(status),
  close: status === 'published' || status === 'pending_review',
  renew: RENEWABLE.includes(status),
  duplicate: true,
});

export const isEditable = (status: JobStatus) => EDITABLE.includes(status);

/** Checks the values (the same rules as the form) and that the category exists and is active. */
export async function validateJob(db: PrismaClient, values: JobValues): Promise<{fields: Record<string, string>} | {columns: JobColumns; html: string}> {
  const fields = {...checkJobValues(values)} as Record<string, string>;
  if (!fields.categoryId) {
    const category = await db.category.findFirst({where: {id: Number(values.categoryId), isActive: true}, select: {id: true}});
    if (!category) fields.categoryId = 'Choose a category.';
  }
  if (Object.keys(fields).length) return {fields};
  const columns = jobColumns(values);
  return {columns, html: renderMarkdown(columns.descriptionMd)};
}

/** The job's own columns from valid values (tags apart). */
export function jobData(columns: JobColumns, html: string, currency: string) {
  const {tags: _tags, applicantCountries, ...rest} = columns;
  void _tags;
  const hasSalary = columns.salaryMinCents !== null || columns.salaryMaxCents !== null;
  return {...rest, applicantCountries: applicantCountries ?? Prisma.DbNull, descriptionHtml: html, salaryCurrency: hasSalary ? currency : null};
}

/** Replaces a job's tags (shared `tags` rows, stored lower-cased, ≤ 5). Bounded: a few rows. */
export async function setJobTags(db: PrismaClient, jobId: number, names: string[]): Promise<void> {
  await db.jobTag.deleteMany({where: {jobId}});
  if (!names.length) return;
  await db.tag.createMany({data: names.map(name => ({name})), skipDuplicates: true});
  const tags = await db.tag.findMany({where: {name: {in: names}}, select: {id: true}, take: 10});
  await db.jobTag.createMany({data: tags.map(tag => ({jobId, tagId: tag.id})), skipDuplicates: true});
}

/** A new job for the company with a unique slug (title + company name). */
export async function createJob(db: PrismaClient, input: {companyId: number; companyName: string; userId: number; data: ReturnType<typeof jobData>; status: JobStatus}) {
  return createWithUniqueSlug(
    `${input.data.title} ${input.companyName}`,
    async slug => (await db.job.findUnique({where: {slug}, select: {id: true}})) !== null,
    slug =>
      db.job.create({
        data: {...input.data, companyId: input.companyId, slug, status: input.status, source: 'paid', createdBy: input.userId},
        select: {id: true, slug: true},
      })
  );
}

const rowSelect = {
  id: true,
  title: true,
  slug: true,
  status: true,
  expiresAt: true,
  viewCount: true,
  applyClickCount: true,
  applicationCount: true,
  isFeatured: true,
  featuredUntil: true,
  rejectionReason: true,
  tierId: true,
} as const;

/** "My jobs", newest first, keyset paged. */
export async function listOwnJobs(db: PrismaClient, companyId: number, before: number | undefined, pageSize: number) {
  const now = new Date();
  const rows = await db.job.findMany({
    where: {companyId, status: {in: LISTED}, ...(before ? {id: {lt: before}} : {})},
    orderBy: {id: 'desc'},
    take: pageSize + 1,
    select: rowSelect,
  });
  const items: EmployerJobRow[] = rows.slice(0, pageSize).map(job => {
    const status = effectiveStatus(job, now);
    return {
      id: job.id,
      title: job.title,
      slug: job.slug,
      status,
      daysLeft: status === 'published' && job.expiresAt ? Math.max(0, Math.ceil((job.expiresAt.getTime() - now.getTime()) / DAY_MS)) : null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      views: job.viewCount,
      applyClicks: job.applyClickCount,
      applicants: job.applicationCount,
      featured: job.isFeatured && (job.featuredUntil === null || job.featuredUntil > now),
      rejectionReason: status === 'rejected' ? job.rejectionReason : null,
      tierId: job.tierId,
      actions: jobActions(status),
    };
  });
  return {items, nextBefore: rows.length > pageSize ? items.at(-1)!.id : null};
}

const detailSelect = {
  id: true,
  slug: true,
  status: true,
  expiresAt: true,
  publishedAt: true,
  tierId: true,
  title: true,
  categoryId: true,
  employmentType: true,
  workplaceType: true,
  locationCity: true,
  locationRegion: true,
  locationCountry: true,
  applicantCountries: true,
  salaryMinCents: true,
  salaryMaxCents: true,
  salaryPeriod: true,
  descriptionMd: true,
  applyMethod: true,
  applyTarget: true,
  tags: {select: {tag: {select: {name: true}}}, take: 10},
} as const;

/** One own job (any listed status), or null: the caller answers 404. */
export async function findOwnJob(db: PrismaClient, companyId: number, id: number) {
  if (!isDbId(id)) return null;
  const job = await db.job.findFirst({where: {id, companyId, status: {in: LISTED}}, select: detailSelect});
  return job;
}

export function toJobDetail(job: NonNullable<Awaited<ReturnType<typeof findOwnJob>>>): EmployerJobDetail {
  const status = effectiveStatus(job);
  return {
    id: job.id,
    slug: job.slug,
    status,
    tierId: job.tierId,
    actions: jobActions(status),
    values: jobValuesOf({...job, tags: job.tags.map(t => t.tag.name)}),
  };
}
