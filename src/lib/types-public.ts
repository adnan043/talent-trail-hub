/**
 * The public board's API shapes (workstream A): `/site-api/jobs`, `/companies`, `/board`.
 * Browser-safe. Every one is built field by field in `src/server/board/public-shapes.ts`.
 */
import type {ApplyMethod, EmploymentType, FontPreset, SalaryPeriod, WorkplaceType} from './board';

export interface SalaryRange {
  minCents: number | null;
  maxCents: number | null;
  currency: string;
  period: SalaryPeriod;
}

/** `active` = published and before `expiresAt`; the page shows a banner otherwise. */
export type JobState = 'active' | 'expired' | 'closed';

export interface PublicCompanyRef {
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** A job card (lists, home, similar jobs, saved). */
export interface PublicJobSummary {
  id: number;
  slug: string;
  title: string;
  company: PublicCompanyRef;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  applicantCountries: string[];
  salary: SalaryRange | null;
  /** Featured right now (`isFeatured` and `featuredUntil` unset or ahead). */
  featured: boolean;
  publishedAt: string | null;
  state: JobState;
  tags: string[];
}

export interface PublicSocialLink {
  kind: 'linkedin' | 'x' | 'github' | 'instagram';
  label: string;
  url: string;
}

export interface PublicCompany extends PublicCompanyRef {
  website: string | null;
  location: string | null;
  /** Sanitized HTML (stored sanitized, sanitized again on output). */
  aboutHtml: string | null;
  socials: PublicSocialLink[];
}

/** One job page (`/jobs/<slug>/`). */
export interface PublicJobDetail extends Omit<PublicJobSummary, 'company'> {
  descriptionHtml: string;
  category: {slug: string; name: string};
  company: PublicCompany;
  applyMethod: ApplyMethod;
  /** The https URL or the email address for `url` / `email`; null for `onsite`. */
  applyTarget: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface JobsPage {
  jobs: PublicJobSummary[];
  /** How many of `jobs` (the first ones) are pinned featured jobs (page 1 only). */
  pinned: number;
  /** Keyset cursor for the next page, or null. */
  nextBefore: string | null;
  /** More featured jobs on the whole board than the pin cap: link `/jobs/?featured=1`. */
  featuredMore: boolean;
  /** Featured jobs on the board, counted up to 100 (100 reads "100+"); 0 after page 1. */
  featuredCount: number;
}

export interface JobDetailResponse {
  job: PublicJobDetail;
  similar: PublicJobSummary[];
  moreAtCompany: PublicJobSummary[];
}

export interface CategoryCount {
  slug: string;
  name: string;
  jobCount: number;
}

export interface PublicCompanySummary extends PublicCompanyRef {
  location: string | null;
  openJobCount: number;
}

export interface CompaniesPage {
  companies: PublicCompanySummary[];
  nextAfter: string | null;
}

export interface CompanyProfileResponse {
  company: PublicCompany;
  jobs: PublicJobSummary[];
}

export interface HomeResponse {
  featured: PublicJobSummary[];
  featuredMore: boolean;
  /** Featured jobs on the board, counted up to 100. */
  featuredCount: number;
  /** The latest list's workplace switch (`?workplace=`), '' for any. */
  workplace: string;
  latest: PublicJobSummary[];
  categories: CategoryCount[];
  /** Marketplace: companies hiring now (≤ 6). */
  companies: PublicCompanySummary[];
  /** Single-company mode: the owner company, shown instead of the companies strip. */
  ownerCompany: PublicCompany | null;
}

/** The board's public settings (the brand and the mode): `GET /site-api/board/settings`. */
export interface PublicBoard {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  fontPreset: FontPreset;
  heroTitle: string;
  heroSubtitle: string;
  footerLinks: {label: string; href: string}[];
  currency: string;
  singleCompany: boolean;
  freePostingEnabled: boolean;
}

export interface PublicTier {
  id: number;
  name: string;
  priceCents: number;
  currency: string;
  durationDays: number;
  includesFeatured: boolean;
}

export interface SitemapResponse {
  jobs: {slug: string; updatedAt: string}[];
  companies: {slug: string; updatedAt: string}[];
  /** List `/companies/`, `/pricing/`, `/post-a-job/` (false on a single-company board). */
  marketplace: boolean;
}
