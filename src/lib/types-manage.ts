/**
 * The admin area's API shapes (`/site-api/manage/*`, workstream D). Browser-safe: the portal
 * screens (src/portal/admin/) read them; the routes (src/server/board/manage-*.ts) build them
 * field by field. Dates are ISO strings; money is minor units + an ISO 4217 currency.
 */
import type {BoardMode, FontPreset, JobSource, JobStatus, ModerationMode} from './board';

/** "12", or "100+" when the bounded read hit its cap. */
export interface Bounded {
  value: number;
  more: boolean;
}

export interface ManageOverview {
  currency: string;
  revenue30d: Bounded;
  revenueAll: Bounded;
  paidOrders: Bounded;
  pendingApprovals: Bounded;
  activeJobs: Bounded;
  applications30d: Bounded;
  companies: Bounded;
  topJobs: {id: number; title: string; slug: string; company: string; views: number; applicants: number}[];
}

export type ActivityRange = '7d' | '30d' | '90d' | '12m';

/** The dashboard's activity table: one row per day (or month for `12m`), newest first. */
export interface ManageActivity {
  currency: string;
  range: ActivityRange;
  granularity: 'day' | 'month';
  /** A read hit its cap: the numbers are a floor. */
  more: boolean;
  rows: {period: string; revenueCents: number; paidOrders: number; refunds: number; jobsPublished: number; applications: number}[];
}

export interface ModerationItem {
  id: number;
  title: string;
  company: {id: number; name: string; isTrusted: boolean};
  source: JobSource;
  flagged: boolean;
  submittedAt: string;
  /** An edit of a live job: approving keeps this expiry. */
  liveUntil: string | null;
  payment: {amountCents: number; currency: string} | null;
}

export interface ModerationQueue {
  items: ModerationItem[];
  /** Keyset cursor over (flagged desc, id asc): `"<0|1>:<id>"`. */
  nextAfter: string | null;
}

export interface ModerationDetail {
  item: ModerationItem;
  job: {
    slug: string;
    descriptionHtml: string;
    category: string;
    employmentType: string;
    workplaceType: string;
    location: string | null;
    salary: {minCents: number | null; maxCents: number | null; currency: string | null; period: string | null} | null;
    applyMethod: string;
    applyTarget: string | null;
    tags: string[];
    durationDays: number;
    listingFeatured: boolean;
  };
  history: {
    companySince: string;
    jobs: number;
    live: number;
    rejected: number;
    more: boolean;
    paidOrders: number;
    spentCents: number;
    /** The company's 5 most recent other jobs. */
    recent: {id: number; title: string; status: JobStatus; createdAt: string}[];
  };
  /** The employer's account: null for admin / import companies. */
  employer: {verified: boolean} | null;
}

export interface ModerationResult {
  status: 'published' | 'rejected';
  message: string;
  /** Reject of a paid job: the platform has no refund API, so the admin refunds by hand. */
  refundNote: string | null;
}

export interface AdminJobActions {
  feature: boolean;
  extend: boolean;
  close: boolean;
  /** False for employer jobs (`paid`, `credit`, `free`): 403 `employer_job_locked`. */
  edit: boolean;
}

export interface AdminJobRow {
  id: number;
  title: string;
  slug: string;
  /** As shown: a published job past its expiry reads `expired`. */
  status: JobStatus;
  source: JobSource;
  company: string;
  category: string;
  featured: boolean;
  featuredUntil: string | null;
  expiresAt: string | null;
  views: number;
  applicants: number;
  createdAt: string;
  /** Employer changes wait for review: feature / extend / relist are refused until approved. */
  needsReview: boolean;
  actions: AdminJobActions;
}

export interface AdminJobsPage {
  jobs: AdminJobRow[];
  nextBefore: number | null;
}

export interface AdminJobFilters {
  status: '' | JobStatus;
  category: string;
  featured: '' | 'yes' | 'no';
  source: '' | JobSource;
  q: string;
}

export interface CompanyOption {
  id: number;
  name: string;
}

export interface AdminCompanies {
  companies: CompanyOption[];
  /** Single-company mode: admin jobs always go to this company. */
  locked: CompanyOption | null;
}

export interface AdminTier {
  id: number;
  name: string;
  priceKey: string | null;
  priceCents: number;
  currency: string;
  durationDays: number;
  includesFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface CataloguePrice {
  key: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
}

export interface AdminTiers {
  tiers: AdminTier[];
  freePostingEnabled: boolean;
  /** The platform's catalogue (one-time prices), or null with `pricesError` when unreachable. */
  prices: CataloguePrice[] | null;
  pricesError: string | null;
  maxActive: number;
  daysMax: number;
}

export interface TierInput {
  name: string;
  priceKey: string | null;
  durationDays: number;
  includesFeatured: boolean;
  isActive: boolean;
}

export interface PrivacyLookup {
  applications: number;
  resumeFiles: number;
  emailLogs: number;
  items: {id: number; jobTitle: string; companyName: string; createdAt: string; hasResume: boolean}[];
  more: boolean;
}

export interface PrivacyDeleted {
  applications: number;
  resumeFiles: number;
  emailLogs: number;
}

export type EmailLogStatus = 'sent' | 'failed' | 'skipped';

export interface EmailLogRow {
  id: string;
  templateKey: string;
  to: string;
  status: EmailLogStatus;
  error: string | null;
  createdAt: string;
}

export interface EmailLogPage {
  emails: EmailLogRow[];
  nextBefore: string | null;
}

export interface FooterLink {
  label: string;
  href: string;
}

export interface AdminBranding {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  /** The dashboard sidebar's colours; empty = the default dark panel. */
  sidebarBg: string;
  sidebarText: string;
  fontPreset: FontPreset;
  heroTitle: string;
  heroSubtitle: string;
  footerLinks: FooterLink[];
}

export interface AdminBoardMode {
  mode: BoardMode;
  /** ISO 4217: salaries and display amounts on the board (tiers carry their catalogue currency). */
  currency: string;
  ownerCompany: CompanyOption | null;
  companies: CompanyOption[];
}

export interface AdminModerationMode {
  mode: ModerationMode;
}

export interface TaskRun {
  summary: Record<string, number>;
  message: string;
}

/** Limits for the admin's forms, mirrored by the validators. */
export const MANAGE_LIMITS = {
  boardName: 80,
  heroTitle: 120,
  heroSubtitle: 240,
  footerLinks: 8,
  footerLabel: 40,
  footerHref: 300,
  tierName: 40,
  featureDaysDefault: 30,
  extendDaysMax: 120,
} as const;

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A footer link: an https URL, or a path on this site (`/about/`). */
export const isFooterHref = (href: string) =>
  /^\/(?![/\\])[^\s]*$/.test(href) || /^https:\/\/[^\s/]+\.[^\s]+$/i.test(href);

/** `GET /manage/jobs/:id`: the job's facts and, for admin / import jobs, its form values. */
export interface AdminJobDetail {
  id: number;
  slug: string;
  title: string;
  status: JobStatus;
  source: JobSource;
  company: CompanyOption;
  featuredUntil: string | null;
  expiresAt: string | null;
  actions: AdminJobActions;
  /** The JobForm's values (strings, see src/lib/job-input.ts). */
  values: Record<string, string>;
}

/** `POST /manage/jobs`: a free admin job, live at once. */
export interface AdminJobCreate {
  values: Record<string, string>;
  /** An existing company, or `newCompanyName` for a new admin company (ignored in single-company mode). */
  companyId: number | null;
  newCompanyName: string;
  durationDays: number;
}

export const EMPLOYER_JOB_NOTE = 'This job was posted by an employer: only they can change its content.';

export interface AdminJobFormOptions {
  categories: {id: number; name: string}[];
  currency: string;
}
