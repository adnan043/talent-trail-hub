import type {Prisma} from '../../generated/prisma/client';
import type {ApplyMethod, EmploymentType, SalaryPeriod, WorkplaceType} from '../../lib/board';
import {sanitizeRichText} from '../../lib/rich-text';
import type {
  JobState,
  PublicCompany,
  PublicCompanySummary,
  PublicJobDetail,
  PublicJobSummary,
  PublicSocialLink,
} from '../../lib/types-public';

/**
 * Database rows → the public shapes (`src/lib/types-public.ts`), field by field. Only the fields
 * in these selects ever leave the server.
 */

export const jobSummarySelect = {
  id: true,
  slug: true,
  title: true,
  employmentType: true,
  workplaceType: true,
  locationCity: true,
  locationRegion: true,
  locationCountry: true,
  applicantCountries: true,
  salaryMinCents: true,
  salaryMaxCents: true,
  salaryCurrency: true,
  salaryPeriod: true,
  isFeatured: true,
  featuredUntil: true,
  status: true,
  publishedAt: true,
  expiresAt: true,
  company: {select: {slug: true, name: true, logoUrl: true}},
  tags: {select: {tag: {select: {name: true}}}, orderBy: {createdAt: 'asc'}, take: 5},
} satisfies Prisma.JobSelect;

export const companySelect = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  website: true,
  location: true,
  aboutHtml: true,
  socials: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

export const jobDetailSelect = {
  ...jobSummarySelect,
  companyId: true,
  categoryId: true,
  descriptionHtml: true,
  applyMethod: true,
  applyTarget: true,
  updatedAt: true,
  category: {select: {slug: true, name: true}},
  company: {select: companySelect},
} satisfies Prisma.JobSelect;

type SummaryRow = Prisma.JobGetPayload<{select: typeof jobSummarySelect}>;
type DetailRow = Prisma.JobGetPayload<{select: typeof jobDetailSelect}>;
type CompanyRow = Prisma.CompanyGetPayload<{select: typeof companySelect}>;

const countryCodes = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && /^[A-Z]{2}$/.test(v)).slice(0, 50) : [];

/** Only https links leave the server (stored links are checked on write; this is the second gate). */
/** A logo kept in the Site Database (`/site-api/companies/<slug>/logo?v=<time>`). */
const LOCAL_LOGO = /^\/site-api\/(?:companies\/[a-z0-9-]{1,100}|board)\/logo\?v=\d{1,15}$/;
/** A public platform file (`publicFileUrl`: a logo or favicon in storage), same origin. */
const PLATFORM_FILE = /^\/__platform\/files\/file_[0-9a-z]{26}\/[A-Za-z0-9._~%!*()'-]{1,300}$/;

export const safeUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (LOCAL_LOGO.test(value) || PLATFORM_FILE.test(value)) return value;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

export function jobState(row: {status: string; expiresAt: Date | null}, now: Date): JobState {
  if (row.status === 'closed') return 'closed';
  return row.status === 'published' && row.expiresAt && row.expiresAt > now ? 'active' : 'expired';
}

export function toJobSummary(row: SummaryRow, now: Date, boardCurrency: string): PublicJobSummary {
  const hasSalary = row.salaryMinCents != null || row.salaryMaxCents != null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    company: {name: row.company.name, slug: row.company.slug, logoUrl: safeUrl(row.company.logoUrl)},
    employmentType: row.employmentType as EmploymentType,
    workplaceType: row.workplaceType as WorkplaceType,
    locationCity: row.locationCity,
    locationRegion: row.locationRegion,
    locationCountry: row.locationCountry,
    applicantCountries: row.workplaceType === 'remote' ? countryCodes(row.applicantCountries) : [],
    salary: hasSalary
      ? {
          minCents: row.salaryMinCents,
          maxCents: row.salaryMaxCents,
          currency: row.salaryCurrency ?? boardCurrency,
          period: (row.salaryPeriod ?? 'YEAR') as SalaryPeriod,
        }
      : null,
    featured: row.isFeatured && (row.featuredUntil == null || row.featuredUntil > now),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    state: jobState(row, now),
    tags: row.tags.map(t => t.tag.name),
  };
}

const SOCIALS: {kind: PublicSocialLink['kind']; label: string}[] = [
  {kind: 'linkedin', label: 'LinkedIn'},
  {kind: 'x', label: 'X'},
  {kind: 'github', label: 'GitHub'},
  {kind: 'instagram', label: 'Instagram'},
];

function socialLinks(value: unknown): PublicSocialLink[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return SOCIALS.flatMap(({kind, label}) => {
    const url = typeof record[kind] === 'string' ? safeUrl(record[kind] as string) : null;
    return url ? [{kind, label, url}] : [];
  });
}

export function toCompany(row: CompanyRow): PublicCompany {
  return {
    name: row.name,
    slug: row.slug,
    logoUrl: safeUrl(row.logoUrl),
    website: safeUrl(row.website),
    location: row.location,
    aboutHtml: row.aboutHtml ? sanitizeRichText(row.aboutHtml) || null : null,
    socials: socialLinks(row.socials),
  };
}

export function toCompanySummary(row: Pick<CompanyRow, 'slug' | 'name' | 'logoUrl' | 'location'>, openJobCount: number): PublicCompanySummary {
  return {name: row.name, slug: row.slug, logoUrl: safeUrl(row.logoUrl), location: row.location, openJobCount};
}

export function toJobDetail(row: DetailRow, now: Date, boardCurrency: string): PublicJobDetail {
  const method = row.applyMethod as ApplyMethod;
  const target = method === 'url' ? safeUrl(row.applyTarget) : method === 'email' ? row.applyTarget : null;
  return {
    ...toJobSummary(row, now, boardCurrency),
    descriptionHtml: sanitizeRichText(row.descriptionHtml),
    category: row.category,
    company: toCompany(row.company),
    applyMethod: method,
    applyTarget: target,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
